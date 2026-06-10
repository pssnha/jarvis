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
import { isConnected, sendDirectText } from '../whatsapp/client';

let polling = false;

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
      try {
        await pollCircleMailbox(circle);
      } catch (err) {
        console.error(`[email] poll failed for ${circle.name}:`, err);
      }
    }
  } finally {
    polling = false;
  }
}

async function pollCircleMailbox(circle: Circle): Promise<void> {
  const pass = circle.emailEncCred ? decryptValue(circle.emailEncCred) : null;
  if (!circle.emailAddress || !pass) return;

  const client = new ImapFlow({
    host: circle.emailHost || 'imap.gmail.com',
    port: circle.emailPort ?? 993,
    secure: true,
    auth: { user: circle.emailAddress, pass },
    logger: false,
  });

  let maxUid = circle.emailLastUid ?? 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // First scan: everything. Later: only UIDs above the last processed one.
      const lastUid = circle.emailLastUid ?? 0;
      const range = circle.emailFirstScanDone ? `${lastUid + 1}:*` : '1:*';
      const found = await client.search({ uid: range }, { uid: true });
      const fresh = (Array.isArray(found) ? found : []).filter((u: number) => u > lastUid);

      for (const uid of fresh) {
        if (uid > maxUid) maxUid = uid;
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const text = parsed.text ?? '';
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

function kindEmoji(kind: string): string {
  return kind === 'vacation' ? '🧳' : kind === 'event' ? '📅' : '🔔';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
