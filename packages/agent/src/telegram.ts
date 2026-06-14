/**
 * Thin Telegram Bot API wrappers (a single shared bot serves every circle).
 * No phone number, no per-circle session — chat ids identify groups, user ids
 * identify senders. Privacy mode must be disabled in BotFather so the bot
 * receives natural group messages, not just commands/mentions.
 */

/** Whether a Telegram bot token is configured. */
export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function apiUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed (${res.status}): ${data.description ?? 'unknown error'}`);
  }
  return data.result;
}

/** Send a text message to a chat (group or private). chatId is numeric-as-string. */
export async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  await call('sendMessage', { chat_id: chatId, text });
}

/** Point Telegram at our webhook (idempotent); secret guards inbound updates. */
export async function setTelegramWebhook(url: string, secret: string): Promise<void> {
  await call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'my_chat_member'] });
}
