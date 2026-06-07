import './loadEnv';
import { buildApp } from './app';
import { env } from './config/env';
import { attachRealtime } from './realtime';
import { ensureAdmin } from './auth';

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();

  // Seed the admin account.
  await ensureAdmin();

  // Socket.IO shares Fastify's underlying HTTP server.
  attachRealtime(app);

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
