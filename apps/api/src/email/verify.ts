import { ImapFlow } from 'imapflow';

/** Best-effort IMAP host for an email address (so the user never types it). */
export function imapHostFor(address: string): string {
  const domain = address.split('@')[1]?.toLowerCase().trim() ?? '';
  if (/(^|\.)(gmail|googlemail)\.com$/.test(domain)) return 'imap.gmail.com';
  if (/(^|\.)(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return 'outlook.office365.com';
  if (/(^|\.)yahoo\.[a-z.]+$/.test(domain)) return 'imap.mail.yahoo.com';
  if (/(^|\.)(icloud|me|mac)\.com$/.test(domain)) return 'imap.mail.me.com';
  if (/(^|\.)aol\.com$/.test(domain)) return 'imap.aol.com';
  return domain ? `imap.${domain}` : 'imap.gmail.com';
}

export interface ImapVerifyResult {
  ok: boolean;
  error?: string;
}

/** Attempt an IMAP login to confirm a mailbox's credentials actually work. */
export async function verifyImap(opts: {
  user: string;
  password: string;
  host: string;
  port: number;
}): Promise<ImapVerifyResult> {
  const client = new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: true,
    auth: { user: opts.user, pass: opts.password },
    logger: false,
    connectionTimeout: 12_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
  });
  try {
    await client.connect();
    return { ok: true };
  } catch (err) {
    const e = err as {
      authenticationFailed?: boolean;
      serverResponseCode?: string;
      code?: string;
      responseText?: string;
    };
    let error = 'Could not sign in to the mailbox.';
    if (e?.authenticationFailed || e?.serverResponseCode === 'AUTHENTICATIONFAILED') {
      error =
        'Invalid credentials — use a Gmail app-password (2-Step Verification and IMAP must be enabled).';
    } else if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') {
      error = `Could not find the mail server ${opts.host}.`;
    } else if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET') {
      error = `Could not reach ${opts.host}:${opts.port}.`;
    } else if (e?.responseText) {
      error = `Mailbox rejected the login: ${e.responseText}`;
    }
    return { ok: false, error };
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}
