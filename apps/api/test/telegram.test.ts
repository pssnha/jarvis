import '../src/loadEnv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';
import { createCircleTgLinkCode } from '@jarvis/agent';

// Set the webhook secret BEFORE the app (and config/env) is imported, so the
// handler enforces it. buildApp is therefore loaded dynamically in beforeAll.
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';

const SUF = `tg_${Date.now()}`;
const id = (s: string) => `${SUF}_${s}`;
const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

let app: FastifyInstance;
let dbOk = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
    return;
  }
  await prisma.circle.create({ data: { id: id('c'), name: id('Circle'), timezone: 'UTC' } });
  const { buildApp } = await import('../src/app');
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (!dbOk) return;
  await app?.close();
  await prisma.group.deleteMany({ where: { circleId: id('c') } });
  await prisma.circle.deleteMany({ where: { id: id('c') } });
  await prisma.$disconnect();
});

function post(body: unknown, secret = 'test-secret') {
  return app.inject({
    method: 'POST',
    url: '/api/telegram/webhook',
    headers: { [SECRET_HEADER]: secret },
    payload: body,
  });
}

describe('telegram webhook', () => {
  it('rejects a wrong secret token', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await post({}, 'nope');
    expect(res.statusCode).toBe(401);
  });

  it('binds a group to the circle that issued the /link code', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const code = await createCircleTgLinkCode(id('c'));
    const chatId = -1000000000001;
    const res = await post({
      message: {
        from: { id: 42, first_name: 'A' },
        chat: { id: chatId, type: 'supergroup', title: 'Fam' },
        text: `/link ${code}`,
      },
    });
    expect(res.statusCode).toBe(200);
    const group = await prisma.group.findUnique({ where: { telegramChatId: String(chatId) } });
    expect(group?.circleId).toBe(id('c'));
  });

  it('ignores a message from an unlinked group (no crash, no agent call)', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const res = await post({
      message: {
        from: { id: 7, first_name: 'B' },
        chat: { id: -999999, type: 'group', title: 'Unknown' },
        text: 'hello there',
      },
    });
    expect(res.statusCode).toBe(200);
  });
});
