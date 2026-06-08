import cookie from '@fastify/cookie';
import oauth2 from '@fastify/oauth2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@jarvis/db';
import { setUserWhatsApp } from '@jarvis/agent';
import { env } from '../config/env';
import { SESSION_COOKIE } from './constants';

const isProd = env.NODE_ENV === 'production';

/** Ensure the seeded admin account exists. */
export async function ensureAdmin(): Promise<void> {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const admin = await prisma.authUser.upsert({
    where: { email },
    update: { role: 'admin' },
    create: { email, role: 'admin' },
  });
  // One-time bootstrap: migrate a configured ADMIN_WHATSAPP into the encrypted
  // column so the admin's 1:1 chat is recognized without an env list.
  if (process.env.ADMIN_WHATSAPP && !admin.waHash) {
    await setUserWhatsApp(admin.id, process.env.ADMIN_WHATSAPP);
  }
}

/** Resolve the signed-in user from the session cookie, or null. */
export async function currentUser(app: FastifyInstance, req: FastifyRequest) {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = app.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return prisma.authUser.findUnique({ where: { id: unsigned.value } });
}

/** Register the cookie plugin and the requireAuth / requireAdmin guards (root scope). */
export async function registerCookieAndGuards(app: FastifyInstance): Promise<void> {
  await app.register(cookie, { secret: env.AUTH_SECRET });

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await currentUser(app, req);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    req.authUser = user;
  });

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await currentUser(app, req);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    if (user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    req.authUser = user;
  });
}

/** Register Google OAuth + /auth/* routes (mounted under /api). */
export async function registerAuthRoutes(api: FastifyInstance): Promise<void> {
  const configured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  if (configured) {
    await api.register(oauth2, {
      name: 'googleOAuth2',
      scope: ['profile', 'email'],
      credentials: {
        client: { id: env.GOOGLE_CLIENT_ID!, secret: env.GOOGLE_CLIENT_SECRET! },
        auth: oauth2.GOOGLE_CONFIGURATION,
      },
      startRedirectPath: '/auth/google/login',
      callbackUri: `${env.AUTH_BASE_URL}/api/auth/google/callback`,
    });

    api.get('/auth/google/callback', async (req, reply) => {
      const { token } = await api.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);
      const info = (await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }).then((r) => r.json())) as { email?: string; name?: string; id?: string };

      const email = info.email?.toLowerCase();
      if (!email) return reply.code(400).send('Could not read email from Google.');

      let user = await prisma.authUser.findUnique({ where: { email } });
      if (!user) {
        if (email === env.ADMIN_EMAIL.toLowerCase()) {
          user = await prisma.authUser.create({
            data: { email, name: info.name, googleSub: info.id, role: 'admin' },
          });
        } else {
          return reply.code(403).type('text/html').send(notAuthorizedHtml(email));
        }
      } else {
        user = await prisma.authUser.update({
          where: { id: user.id },
          data: { googleSub: info.id, name: user.name ?? info.name },
        });
      }

      reply.setCookie(SESSION_COOKIE, user.id, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
      return reply.redirect(`${env.AUTH_BASE_URL}/`);
    });
  } else {
    api.get('/auth/google/login', async (_req, reply) =>
      reply.code(503).type('text/html').send(notConfiguredHtml()),
    );
  }

  api.get('/auth/me', async (req, reply) => {
    const user = await currentUser(api, req);
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  });

  api.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}

function notConfiguredHtml(): string {
  return `<!doctype html><h1>Google sign-in isn't configured yet</h1>
  <p>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in the server environment.</p>`;
}

function notAuthorizedHtml(email: string): string {
  return `<!doctype html><h1>Not authorized</h1>
  <p><strong>${email}</strong> isn't a member yet. Ask an admin to add you, then sign in again.</p>
  <p><a href="${env.AUTH_BASE_URL}/">Back</a></p>`;
}
