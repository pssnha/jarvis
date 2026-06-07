import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env';
import { registerCookieAndGuards, registerAuthRoutes } from './auth';
import { registerHealth } from './routes/health';
import { registerCalendar } from './routes/calendar';
import { registerGroups } from './routes/groups';
import { registerAdmin } from './routes/admin';
import { registerWhatsApp } from './whatsapp';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: env.PUBLIC_WEB_ORIGIN, credentials: true });

  // Cookie plugin + requireAuth / requireAdmin guards (root scope).
  await registerCookieAndGuards(app);

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

  await app.register(
    async (api) => {
      // --- Public ---
      await registerHealth(api); // /api/healthz
      await registerCalendar(api); // /api/calendar/:token.ics (secret token)
      await registerWhatsApp(api); // /api/whatsapp/webhook (signature-verified)
      await registerAuthRoutes(api); // /api/auth/*

      // --- Authenticated users ---
      await api.register(async (scoped) => {
        scoped.addHook('preHandler', app.requireAuth);
        await registerGroups(scoped);
      });

      // --- Admins only ---
      await api.register(async (scoped) => {
        scoped.addHook('preHandler', app.requireAdmin);
        await registerAdmin(scoped);
      });
    },
    { prefix: '/api' },
  );

  return app;
}
