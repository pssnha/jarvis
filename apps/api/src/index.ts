import './loadEnv';
import { buildApp } from './app';
import { env } from './config/env';
import { attachRealtime } from './realtime';
import { ensureAdmin } from './auth';
import { ensureMaintenanceGroup } from '@jarvis/agent';

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();

  // Seed the admin account + the internal maintenance calendar.
  await ensureAdmin();
  await ensureMaintenanceGroup(process.env.DEFAULT_TIMEZONE ?? 'America/Los_Angeles');

  // Socket.IO shares Fastify's underlying HTTP server.
  attachRealtime(app);

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
