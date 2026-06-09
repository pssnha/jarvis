import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { prisma, type Group } from '@jarvis/db';
import {
  analyzeEmail,
  createProposals,
  decryptValue,
  listPendingProposals,
  markNotified,
} from '@jarvis/agent';
import { isConnected, sendGroupText } from '../whatsapp/client';

let polling = false;

/** Poll every group that has a configured, enabled mailbox. */
export async function pollGroupMailboxes(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const groups = await prisma.group.findMany({
      where: { emailEnabled: true, emailAddress: { not: null }, emailEncCred: { not: null } },
    });
    for (const group of groups) {
      try {
        await pollGroupMailbox(group);
      } catch (err) {
        console.error(`[group-email] poll failed for ${group.name}:`, err);
      }
    }
  } finally {
    polling = false;
  }
}

async function pollGroupMailbox(group: Group): Promise<void> {
  const pass = group.emailEncCred ? decryptValue(group.emailEncCred) : null;
  if (!group.emailAddress || !pass) return;

  const client = new ImapFlow({
    host: group.emailHost || 'imap.gmail.com',
    port: group.emailPort ?? 993,
    secure: true,
    auth: { user: group.emailAddress, pass },
    logger: false,
  });

  let maxUid = group.emailLastUid ?? 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // First scan: everything. Later: only UIDs above the last processed one.
      const lastUid = group.emailLastUid ?? 0;
      const range = group.emailFirstScanDone ? `${lastUid + 1}:*` : '1:*';
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
            timezone: group.timezone,
          });
          if (proposals.length > 0) {
            await createProposals(group.id, proposals, {
              fromEmail: parsed.from?.value?.[0]?.address?.toLowerCase(),
              subject: parsed.subject ?? undefined,
              messageId: parsed.messageId ?? undefined,
            });
          }
        } catch (err) {
          console.error(`[group-email] analyze failed (uid ${uid}):`, err);
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

  await prisma.group.update({
    where: { id: group.id },
    data: { emailLastUid: maxUid, emailFirstScanDone: true, emailLastPolledAt: new Date() },
  });

  await notifyPending(group);
}

const CHUNK = 12;

/** Post any not-yet-notified pending proposals to the group's WhatsApp chat. */
async function notifyPending(group: Group): Promise<void> {
  if (!group.whatsappGroupId || !isConnected()) return;
  const pending = (await listPendingProposals(group.id)).filter((p) => p.notifiedAt === null);
  if (pending.length === 0) return;

  const header =
    pending.length === 1
      ? '📥 I found 1 item in the inbox. Reply to add it or skip it:'
      : `📥 I found ${pending.length} items in the inbox. Reply with which to add (e.g. "add 1 and 3", "add all", or "no"):`;
  await sendGroupText(group.whatsappGroupId, header);

  for (let i = 0; i < pending.length; i += CHUNK) {
    const lines = pending
      .slice(i, i + CHUNK)
      .map((p) => `[${p.code}] ${kindEmoji(p.kind)} ${p.summary}`)
      .join('\n');
    await sendGroupText(group.whatsappGroupId, lines);
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
