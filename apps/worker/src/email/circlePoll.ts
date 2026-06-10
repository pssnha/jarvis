import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { prisma, type Circle } from '@jarvis/db';
import {
  adminWhatsAppNumber,
  analyzeEmail,
  createProposals,
  decryptValue,
  listPendingProposals,
  markNotified,
} from '@jarvis/agent';
import { createRedis } from '../lib/redis';
import { isConnected, sendDirectText } from '../whatsapp/client';

let polling = false;
const inFlight = new Set<string>();
const EMAIL_CONTROL = 'email:control';

/** Poll every circle that has a configured, enabled mailbox (maintenance job). */
export async function pollCircleMailboxes(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const circles = await prisma.circle.findMany({
      where: { emailEnabled: true, emailAddress: { not: null }, emailEncCred: { not: null } },
      include: { mutedJobs: { select: { job: true } } },
    });
    for (const circle of circles) {
      if (circle.mutedJobs.some((m) => m.job === 'email_poll')) continue;
      await runPollForCircle(circle);
    }
  } finally {
    polling = false;
  }
}

/** Poll one circle's mailbox immediately (ad-hoc, from the Admin "Poll now"). */
export async function pollOneCircle(circleId: string): Promise<void> {
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle || !circle.emailAddress || !circle.emailEncCred) return;
  await runPollForCircle(circle);
}

/** Subscribe to ad-hoc poll requests published by the API. */
export function startEmailControl(): void {
  const sub = createRedis();
  void sub.subscribe(EMAIL_CONTROL);
  sub.on('message', (_chan, raw) => {
    try {
      const m = JSON.parse(raw) as { action: 'poll'; circleId: string };
      if (m.action === 'poll' && m.circleId) void pollOneCircle(m.circleId).catch(() => {});
    } catch {
      /* ignore malformed control messages */
    }
  });
}

/** Run one circle's poll, dedup concurrent runs, and record the result. */
async function runPollForCircle(circle: Circle): Promise<void> {
  if (inFlight.has(circle.id)) return;
  inFlight.add(circle.id);
  try {
    let scanned = 0;
    let found = 0;
    let error: string | null = null;
    try {
      const r = await pollCircleMailbox(circle);
      scanned = r.scanned;
      found = r.found;
    } catch (err) {
      error = (err as Error).message ?? String(err);
      console.error(`[email] poll failed for ${circle.name}:`, err);
    }
    await recordPoll(circle.id, scanned, found, error);
  } finally {
    inFlight.delete(circle.id);
  }
}

const POLL_LOG_RETENTION_MS = 14 * 24 * 3_600_000; // keep 14 days of poll history

/** Append a poll-run row and prune old history. */
async function recordPoll(
  circleId: string,
  scanned: number,
  found: number,
  error: string | null,
): Promise<void> {
  try {
    await prisma.emailPollLog.create({
      data: { circleId, scanned, found, error: error ? error.slice(0, 500) : null },
    });
    await prisma.emailPollLog.deleteMany({
      where: { circleId, ranAt: { lt: new Date(Date.now() - POLL_LOG_RETENTION_MS) } },
    });
  } catch (err) {
    console.error('[email] failed to record poll log:', err);
  }
}

async function pollCircleMailbox(circle: Circle): Promise<{ scanned: number; found: number }> {
  const pass = circle.emailEncCred ? decryptValue(circle.emailEncCred) : null;
  if (!circle.emailAddress || !pass) return { scanned: 0, found: 0 };
  let scanned = 0;
  let foundCount = 0;

  const client = new ImapFlow({
    host: circle.emailHost || 'imap.gmail.com',
    port: circle.emailPort ?? 993,
    secure: true,
    auth: { user: circle.emailAddress, pass },
    logger: false,
    // Never let a hung connection stall polling indefinitely.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  let maxUid = circle.emailLastUid ?? 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // First scan: everything. Later: only UIDs above the last processed one.
      const lastUid = circle.emailLastUid ?? 0;
      const range = circle.emailFirstScanDone ? `${lastUid + 1}:*` : '1:*';
      const searchRes = await client.search({ uid: range }, { uid: true });
      const fresh = (Array.isArray(searchRes) ? searchRes : []).filter((u: number) => u > lastUid);
      scanned = fresh.length;

      for (const uid of fresh) {
        if (uid > maxUid) maxUid = uid;
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        // Many real emails (airline/hotel/school) are HTML-only — fall back to a
        // stripped version of the HTML body so they aren't silently skipped.
        const text = bodyText(parsed.text, typeof parsed.html === 'string' ? parsed.html : null);
        if (!text.trim()) continue;
        try {
          const proposals = await analyzeEmail({
            text,
            subject: parsed.subject ?? undefined,
            timezone: circle.timezone,
          });
          if (proposals.length > 0) {
            await createProposals(circle.id, proposals, {
              fromEmail: parsed.from?.value?.[0]?.address?.toLowerCase(),
              subject: parsed.subject ?? undefined,
              messageId: parsed.messageId ?? undefined,
            });
            foundCount += proposals.length;
          }
        } catch (err) {
          console.error(`[email] analyze failed (uid ${uid}):`, err);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }

  await prisma.circle.update({
    where: { id: circle.id },
    data: { emailLastUid: maxUid, emailFirstScanDone: true, emailLastPolledAt: new Date() },
  });

  await notifyPending(circle);
  return { scanned, found: foundCount };
}

const CHUNK = 12;

/** DM any not-yet-notified pending proposals to the circle's owner (admin). */
async function notifyPending(circle: Circle): Promise<void> {
  if (!isConnected(circle.id)) return;
  const owner = await adminWhatsAppNumber();
  if (!owner) return;
  const pending = (await listPendingProposals(circle.id)).filter((p) => p.notifiedAt === null);
  if (pending.length === 0) return;

  const header =
    pending.length === 1
      ? `📥 [${circle.name}] I found 1 item in the inbox. Reply to add it or skip it:`
      : `📥 [${circle.name}] I found ${pending.length} items in the inbox. Reply with which to add (e.g. "add 1 and 3", "add all", or "no"):`;
  await sendDirectText(circle.id, owner, header);

  for (let i = 0; i < pending.length; i += CHUNK) {
    const lines = pending
      .slice(i, i + CHUNK)
      .map((p) => `[${p.code}] ${kindEmoji(p.kind)} ${p.summary}`)
      .join('\n');
    await sendDirectText(circle.id, owner, lines);
    if (i + CHUNK < pending.length) await sleep(800);
  }

  await markNotified(pending.map((p) => p.id));
}

/** Plain text for analysis: the text part, or HTML stripped to readable text. */
function bodyText(text: string | undefined, html: string | null): string {
  if (text && text.trim()) return text;
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function kindEmoji(kind: string): string {
  return kind === 'vacation' ? '🧳' : kind === 'event' ? '📅' : '🔔';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
