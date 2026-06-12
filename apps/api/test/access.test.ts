import '../src/loadEnv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';
import { buildApp } from '../src/app';
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
let dbOk = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
    return;
  }

  await prisma.circle.create({ data: { id: id('A'), name: id('Circle A'), timezone: 'UTC' } });
  await prisma.circle.create({ data: { id: id('B'), name: id('Circle B'), timezone: 'UTC' } });

  // userA is a plain member of circle A only (matched by email), not of B.
  const email = `${id('a')}@example.com`;
  await prisma.member.create({ data: { id: id('mA'), circleId: id('A'), name: 'A', email } });
  const userA = await prisma.authUser.create({ data: { email, role: 'member' } });

  app = await buildApp();
  await app.ready();
  cookieA = app.signCookie(userA.id);
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
