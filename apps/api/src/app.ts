import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env';
import { registerHealth } from './routes/health';
import { registerWhatsApp } from './whatsapp';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: env.PUBLIC_WEB_ORIGIN });

  // Keep the raw JSON body (needed for WhatsApp signature verification) while
  // still parsing JSON for every route.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      (req as { rawBody?: Buffer }).rawBody = body as Buffer;
      const text = (body as Buffer).toString('utf8');
      try {
        done(null, text ? JSON.parse(text) : {});
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // All REST + webhook routes live under /api (matches the nginx proxy config).
  await app.register(
    async (api) => {
      await registerHealth(api);
      await registerWhatsApp(api);
    },
    { prefix: '/api' },
  );

  return app;
}
