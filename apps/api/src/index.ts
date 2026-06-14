import './loadEnv';
import { buildApp } from './app';
import { env } from './config/env';
import { attachRealtime } from './realtime';
import { ensureAdmin } from './auth';
import { setTelegramWebhook } from '@jarvis/agent';

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();

  // Seed the admin account.
  await ensureAdmin();

  // Socket.IO shares Fastify's underlying HTTP server.
  attachRealtime(app);

  // Point the Telegram bot at our webhook (idempotent; best-effort).
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET) {
    void setTelegramWebhook(
      `${env.AUTH_BASE_URL}/api/telegram/webhook`,
      env.TELEGRAM_WEBHOOK_SECRET,
    ).catch((err) => app.log.error({ err }, 'telegram setWebhook failed'));
  }

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
