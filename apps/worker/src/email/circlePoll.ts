import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { prisma, type Circle } from '@jarvis/db';
import {
  adminTelegramId,
  adminWhatsAppNumber,
  analyzeEmail,
  circleUsageStatus,
  createProposals,
  decryptValue,
  expireStaleProposals,
  ingestItineraryDocument,
  listPendingProposals,
  markNotified,
} from '@jarvis/agent';
import { createRedis } from '../lib/redis';
import { isConnected } from '../whatsapp/client';
import { sendDirect } from '../send';

let polling = false;
const inFlight = new Set<string>();
const EMAIL_CONTROL = 'email:control';

/** Poll every circle that has a configured, enabled mailbox (maintenance job). */
export async function pollCircleMailboxes(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const circles = await prisma.circle.findMany({
      where: {
        deletedAt: null, // skip soft-deleted (dormant) circles
        emailEnabled: true,
        emailAddress: { not: null },
        emailEncCred: { not: null },
      },
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
    // Email extraction is an LLM cost — skip while the circle is over its cap.
    // Mail isn't lost: emailLastUid only advances after processing, so unread
    // messages are picked up once the window resets.
    if ((await circleUsageStatus(circle.id, circle.timezone)).blocked) {
      await recordPoll(circle.id, 0, 0, 'skipped: usage limit reached');
      return;
    }
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
  // Auto-applied itinerary attachments (PDFs) — summarised to the admin after the poll.
  const itinerarySummaries: string[] = [];

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

  try {
    await client.connect();
    // The INBOX is the work queue: every message in it is unprocessed. Once we
    // analyze a message we move it to the "Processed" label to keep the inbox clean.
    const processed = await resolveProcessedMailbox(client);
    const lock = await client.getMailboxLock('INBOX');
    try {
      const all = await client.search({ all: true }, { uid: true });
      const uids = Array.isArray(all) ? all : [];
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        scanned++;
        try {
          const parsed = await simpleParser(msg.source);
          // HTML-only emails (airline/hotel/school) have no plain-text part — fall
          // back to a stripped HTML body so they aren't skipped.
          const text = bodyText(parsed.text, typeof parsed.html === 'string' ? parsed.html : null);
          if (text.trim()) {
            const proposals = await analyzeEmail({
              text,
              subject: parsed.subject ?? undefined,
              timezone: circle.timezone,
              circleId: circle.id,
            });
            if (proposals.length > 0) {
              const created = await createProposals(circle.id, proposals, {
                fromEmail: parsed.from?.value?.[0]?.address?.toLowerCase(),
                subject: parsed.subject ?? undefined,
                messageId: parsed.messageId ?? undefined,
              });
              foundCount += created.length; // actually-persisted items (de-dup aware)
            }
          }
          // PDF attachments are treated as full itineraries: parse and apply them
          // directly to the matching trip (auto-apply), then summarise to the admin.
          for (const att of parsed.attachments ?? []) {
            const isPdf =
              att.contentType === 'application/pdf' || /\.pdf$/i.test(att.filename ?? '');
            if (!isPdf || !att.content || att.content.length > 8 * 1024 * 1024) continue;
            try {
              const res = await ingestItineraryDocument({
                circleId: circle.id,
                zone: circle.timezone,
                documents: [
                  {
                    data: att.content.toString('base64'),
                    mediaType: 'application/pdf',
                    filename: att.filename ?? undefined,
                  },
                ],
                context: parsed.subject ? `Email subject: ${parsed.subject}` : undefined,
                source: 'email',
              });
              if (res.ok) {
                foundCount++;
                itinerarySummaries.push(res.message);
              }
            } catch (err) {
              console.error(`[email] itinerary attachment failed for uid ${uid}:`, err);
            }
          }
          // Processed — move it out of the inbox. If there's no Processed label we
          // leave it (messageId de-dup still prevents duplicate proposals).
          if (processed) await client.messageMove(String(uid), processed, { uid: true });
        } catch (err) {
          // Leave the message in the inbox for the next poll to retry.
          console.error(`[email] processing uid ${uid} failed:`, err);
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
    data: { emailFirstScanDone: true, emailLastPolledAt: new Date() },
  });

  // Drop a stale backlog of never-decided proposals before notifying, so a
  // later "add all" only acts on what's currently in the inbox.
  await expireStaleProposals(circle.id);
  await notifyPending(circle);
  if (itinerarySummaries.length > 0) await notifyItineraries(circle, itinerarySummaries);
  return { scanned, found: foundCount };
}

/** DM the admin a summary of itineraries auto-applied from email attachments. */
async function notifyItineraries(circle: Circle, summaries: string[]): Promise<void> {
  const tgId = await adminTelegramId();
  const waNumber = tgId ? null : await adminWhatsAppNumber();
  if (!tgId && !waNumber) return;
  if (waNumber && !isConnected(circle.id)) return;
  for (const summary of summaries) {
    await sendDirect(circle.id, { tgId, waNumber }, `[${circle.name}] ${summary}`);
    await sleep(800);
  }
}

const CHUNK = 12;

/** DM any not-yet-notified pending proposals to the circle's owner (admin). */
async function notifyPending(circle: Circle): Promise<void> {
  // Prefer Telegram if the admin linked it, else fall back to WhatsApp.
  const tgId = await adminTelegramId();
  const waNumber = tgId ? null : await adminWhatsAppNumber();
  if (!tgId && !waNumber) return;
  if (waNumber && !isConnected(circle.id)) return;
  const send = (text: string) => sendDirect(circle.id, { tgId, waNumber }, text);

  const pending = (await listPendingProposals(circle.id)).filter((p) => p.notifiedAt === null);
  if (pending.length === 0) return;

  const header =
    pending.length === 1
      ? `📥 [${circle.name}] I found 1 item in the inbox. Reply to add it or skip it:`
      : `📥 [${circle.name}] I found ${pending.length} items in the inbox. Reply with which to add (e.g. "add 1 and 3", "add all", or "no"):`;
  await send(header);

  for (let i = 0; i < pending.length; i += CHUNK) {
    const lines = pending
      .slice(i, i + CHUNK)
      .map((p) => `[${p.code}] ${kindEmoji(p.kind)} ${p.summary}`)
      .join('\n');
    await send(lines);
    if (i + CHUNK < pending.length) await sleep(800);
  }

  await markNotified(pending.map((p) => p.id));
}

/** The Gmail label/folder processed mail is moved to (keeps the inbox clean). */
const PROCESSED_MAILBOX = process.env.EMAIL_PROCESSED_MAILBOX ?? 'Processed';

/** Find the "Processed" mailbox path (creating the label if it doesn't exist). */
async function resolveProcessedMailbox(client: ImapFlow): Promise<string | null> {
  try {
    const boxes = await client.list();
    const match = boxes.find(
      (b) =>
        b.path === PROCESSED_MAILBOX ||
        b.name === PROCESSED_MAILBOX ||
        b.path.toLowerCase() === PROCESSED_MAILBOX.toLowerCase(),
    );
    if (match) return match.path;
    await client.mailboxCreate(PROCESSED_MAILBOX);
    return PROCESSED_MAILBOX;
  } catch (err) {
    console.error('[email] could not resolve/create the Processed mailbox:', err);
    return null;
  }
}

/** Plain text for analysis: the text part, or HTML stripped to readable text,
 *  with URL/link noise removed so the classifier sees the actual content. */
function bodyText(text: string | undefined, html: string | null): string {
  let s: string;
  if (text && text.trim()) {
    s = text;
  } else if (html) {
    s = html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  } else {
    return '';
  }
  return s
    .replace(/\[https?:\/\/[^\]\s]*\]/gi, '') // [https://…] link references
    .replace(/https?:\/\/\S+/gi, '') // bare URLs
    .replace(/[^\S\n]{2,}/g, ' ') // collapse runs of spaces/tabs, keep newlines
    .trim();
}

function kindEmoji(kind: string): string {
  return kind === 'vacation' ? '🧳' : kind === 'event' ? '📅' : '🔔';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
