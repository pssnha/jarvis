import '../src/loadEnv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';
import { hashPassphrase } from '@jarvis/agent';
import { SESSION_COOKIE } from '../src/auth/constants';

/**
 * Proves circle access control at the HTTP layer: a user who belongs to circle A
 * can reach A's `:cid` routes but is 403'd on circle B's — across both the
 * user-facing scope (circles/vacations) and the admin scope. Locks in the
 * requireCircleParam guard so a future unscoped `:cid` route is caught.
 *
 * DB-gated: skipped wholesale when no database is reachable (bare CI).
 */

const SUF = `acc_${Date.now()}`;
const id = (s: string) => `${SUF}_${s}`;

let app: FastifyInstance;
let cookieA = '';
let cookieAdmin = '';
let dbOk = false;
const PASS = 'open sesame';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
    return;
  }

  await prisma.circle.create({ data: { id: id('A'), name: id('Circle A'), timezone: 'UTC' } });
  // Circle B is not one the admin belongs to; it has a support passphrase set.
  await prisma.circle.create({
    data: {
      id: id('B'),
      name: id('Circle B'),
      timezone: 'UTC',
      supportPassphraseHash: hashPassphrase(PASS),
    },
  });

  // userA is a member + per-circle admin of circle A only (matched by email), not of B.
  const email = `${id('a')}@example.com`;
  await prisma.member.create({ data: { id: id('mA'), circleId: id('A'), name: 'A', email } });
  const userA = await prisma.authUser.create({ data: { email, role: 'member' } });
  await prisma.circleAdmin.create({ data: { circleId: id('A'), authUserId: userA.id } });

  // A site admin who is a member of NO circle.
  const adminUser = await prisma.authUser.create({
    data: { email: `${id('admin')}@example.com`, role: 'admin' },
  });

  // Deferred so bare CI (no DB, no DATABASE_URL) skips before loading the app,
  // which parses required env (DATABASE_URL) at import and would otherwise throw.
  const { buildApp } = await import('../src/app');
  app = await buildApp();
  await app.ready();
  cookieA = app.signCookie(userA.id);
  cookieAdmin = app.signCookie(adminUser.id);
});

afterAll(async () => {
  if (!dbOk) return;
  await app?.close();
  await prisma.member.deleteMany({ where: { circleId: { in: [id('A'), id('B')] } } });
  await prisma.authUser.deleteMany({ where: { email: { contains: SUF } } });
  await prisma.circle.deleteMany({ where: { id: { in: [id('A'), id('B')] } } });
  await prisma.$disconnect();
});

function get(path: string) {
  return app.inject({ method: 'GET', url: path, cookies: { [SESSION_COOKIE]: cookieA } });
}
function getAs(cookie: string, path: string) {
  return app.inject({ method: 'GET', url: path, cookies: { [SESSION_COOKIE]: cookie } });
}
function sendAs(cookie: string, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  return app.inject({ method, url: path, cookies: { [SESSION_COOKIE]: cookie }, payload: body });
}

describe('circle access control (HTTP)', () => {
  it('lets a member read their own circle', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await get(`/api/circles/${id('A')}/vacations`);
    expect(res.statusCode).toBe(200);
  });

  it("403s a member on another circle's trips", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await get(`/api/circles/${id('B')}/vacations`);
    expect(res.statusCode).toBe(403);
  });

  it("403s a member on another circle's members", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await get(`/api/circles/${id('B')}/members`);
    expect(res.statusCode).toBe(403);
  });

  it("403s a member on an admin route for another circle (guard before requireCircle)", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/circles/${id('B')}/cover`,
      cookies: { [SESSION_COOKIE]: cookieA },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('members-only schedule access + break-glass (site admin)', () => {
  it('site admin (non-member) is 403 on a circle calendar', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await getAs(cookieAdmin, `/api/circles/${id('B')}/calendar`);
    expect(res.statusCode).toBe(403);
  });

  it('site admin does not see circles they are not a member of in /circles', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await getAs(cookieAdmin, '/api/circles');
    const ids = (res.json() as { id: string }[]).map((c) => c.id);
    expect(ids).not.toContain(id('B'));
  });

  it('admin list shows the circle as locked (health only)', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await getAs(cookieAdmin, '/api/admin/circles');
    const entry = (res.json() as { id: string; locked?: boolean; members?: unknown }[]).find(
      (c) => c.id === id('B'),
    );
    expect(entry?.locked).toBe(true);
    expect(entry?.members).toBeUndefined();
  });

  it('a bare site admin cannot set the support passphrase', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await sendAs(cookieAdmin, 'PUT', `/api/admin/circles/${id('B')}/support-passphrase`, {
      passphrase: 'hijack',
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an incorrect passphrase', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await sendAs(cookieAdmin, 'POST', `/api/admin/circles/${id('B')}/support-access`, {
      passphrase: 'nope',
    });
    expect(res.statusCode).toBe(401);
  });

  it('unlocks time-limited access with the correct passphrase, then grants data access', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const unlock = await sendAs(cookieAdmin, 'POST', `/api/admin/circles/${id('B')}/support-access`, {
      passphrase: PASS,
    });
    expect(unlock.statusCode).toBe(200);
    // Now the admin can read the circle's schedule…
    const cal = await getAs(cookieAdmin, `/api/circles/${id('B')}/calendar`);
    expect(cal.statusCode).toBe(200);
    // …and the admin list shows it unlocked (full record).
    const list = await getAs(cookieAdmin, '/api/admin/circles');
    const entry = (list.json() as { id: string; locked?: boolean; members?: unknown }[]).find(
      (c) => c.id === id('B'),
    );
    expect(entry?.locked).toBe(false);
    expect(entry?.members).toBeDefined();
  });

  it('an insider (member) can set their circle’s support passphrase', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await sendAs(cookieA, 'PUT', `/api/admin/circles/${id('A')}/support-passphrase`, {
      passphrase: 'family secret',
    });
    expect(res.statusCode).toBe(200);
  });
});
