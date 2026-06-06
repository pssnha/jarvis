import { buildApp } from './app';
import { env } from './config/env';
import { attachRealtime } from './realtime';

async function main(): Promise<void> {
  const app = await buildApp();
  await app.ready();

  // Socket.IO shares Fastify's underlying HTTP server.
  attachRealtime(app.server);

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
