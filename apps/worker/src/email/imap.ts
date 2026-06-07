import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ingestForwardedEmail } from '@jarvis/agent';

interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}

function readConfig(): ImapConfig | null {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  if (!host || !user || !pass) return null;
  return {
    host,
    user,
    pass,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: (process.env.IMAP_TLS ?? 'true') !== 'false',
  };
}

let polling = false;

/**
 * Poll the Jarvis mailbox for unread forwarded schedules, extract events from
 * each, and add them to the matching group. No-op if IMAP isn't configured.
 */
export async function pollMailbox(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) return; // IMAP not configured — skip silently.
  if (polling) return; // avoid overlapping polls
  polling = true;

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) return;

      for await (const msg of client.fetch(uids, { source: true }, { uid: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase();
        const text = parsed.text ?? '';

        if (fromEmail && text) {
          try {
            const result = await ingestForwardedEmail({
              fromEmail,
              subject: parsed.subject ?? undefined,
              text,
              messageId: parsed.messageId ?? undefined,
            });
            if (result.matched) {
              console.log(`[email] ${fromEmail}: created ${result.createdCount} event(s)`);
            } else {
              console.log(`[email] ${fromEmail}: no matching group member, skipped`);
            }
          } catch (err) {
            console.error('[email] ingest failed:', err);
          }
        }

        // Mark processed so we don't handle it again.
        await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[email] IMAP poll failed:', err);
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
    polling = false;
  }
}
