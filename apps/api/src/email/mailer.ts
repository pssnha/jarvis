import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface OutboundMail {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback; derived from the HTML when omitted. */
  text?: string;
}

let transporter: Transporter | null | undefined;

/** Lazily build the SMTP transport, or null when SMTP isn't configured. */
function getTransport(): Transporter | null {
  if (transporter !== undefined) return transporter;
  if (!env.SMTP_HOST) {
    transporter = null;
    return null;
  }
  transporter = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
  });
  return transporter;
}

/** The From: address for all outbound mail. */
function fromAddress(): string {
  return env.MAIL_FROM || env.ADMIN_NOTIFY_EMAIL;
}

/** Strip tags for a plain-text fallback when none was supplied. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Send an email. When SMTP isn't configured (e.g. local dev), the message is
 * logged to the console instead of delivered, so flows never hard-fail.
 */
export async function sendMail(mail: OutboundMail): Promise<void> {
  const text = mail.text ?? htmlToText(mail.html);
  const t = getTransport();
  if (!t) {
    console.warn(
      `[mailer] SMTP not configured — would send to ${mail.to}\n` +
        `  Subject: ${mail.subject}\n` +
        text
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n'),
    );
    return;
  }
  try {
    await t.sendMail({ from: fromAddress(), to: mail.to, subject: mail.subject, html: mail.html, text });
  } catch (err) {
    // Never let a mail failure break the request that triggered it.
    console.error(`[mailer] failed to send to ${mail.to}:`, (err as Error).message);
  }
}
