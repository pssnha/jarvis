import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './config/env';
import { registerCookieAndGuards, registerAuthRoutes } from './auth';
import { registerHealth } from './routes/health';
import { registerCalendar } from './routes/calendar';
import { registerCircles } from './routes/circles';
import { registerVacations } from './routes/vacations';
import { registerAdmin } from './routes/admin';
import { registerWhatsApp } from './whatsapp';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: env.PUBLIC_WEB_ORIGIN, credentials: true });

  // File uploads (ICS / JSON schedule imports).
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

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
        await registerCircles(scoped);
        await registerVacations(scoped);
      });

      // --- Admin area (site admins + per-circle admins; enforced per route) ---
      await api.register(async (scoped) => {
        scoped.addHook('preHandler', app.requireAuth);
        await registerAdmin(scoped);
      });
    },
    { prefix: '/api' },
  );

  return app;
}
