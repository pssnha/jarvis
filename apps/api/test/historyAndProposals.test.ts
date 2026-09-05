import '../src/loadEnv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@jarvis/db';
import { appendMessages, expireStaleProposals, listPendingProposals, loadHistory } from '@jarvis/agent';

/**
 * Regression coverage:
 *  - loadHistory returns the most RECENT turns (chronological), not the oldest.
 *  - listPendingProposals ignores a stale backlog so "add all" stays scoped.
 *
 * DB-gated: skipped when no database is reachable.
 */

const SUF = `hp_${Date.now()}`;
const id = (s: string) => `${SUF}_${s}`;
let dbOk = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
    return;
  }
  await prisma.circle.create({ data: { id: id('C'), name: id('Circle'), timezone: 'America/Los_Angeles' } });
  const convo = await prisma.conversation.create({
    data: { id: id('CONV'), circleId: id('C'), channel: 'whatsapp' },
  });
  // 25 messages, oldest→newest; the last one is the recent context.
  for (let i = 0; i < 25; i++) {
    await prisma.message.create({
      data: {
        conversationId: convo.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `msg ${i}`,
        createdAt: new Date(Date.now() - (25 - i) * 60_000),
      },
    });
  }
  // Proposals: one fresh, one 10 days old (stale).
  await prisma.emailProposal.create({
    data: { circleId: id('C'), code: '1', kind: 'event', title: 'Fresh', summary: 'Fresh', payload: '{}' },
  });
  await prisma.emailProposal.create({
    data: {
      circleId: id('C'), code: '2', kind: 'event', title: 'Stale', summary: 'Stale', payload: '{}',
      createdAt: new Date(Date.now() - 10 * 86_400_000),
    },
  });
});

afterAll(async () => {
  if (!dbOk) return;
  await prisma.message.deleteMany({ where: { conversationId: id('CONV') } });
  await prisma.conversation.deleteMany({ where: { circleId: id('C') } });
  await prisma.emailProposal.deleteMany({ where: { circleId: id('C') } });
  await prisma.circle.deleteMany({ where: { id: id('C') } });
  await prisma.$disconnect();
});

describe('loadHistory', () => {
  it('returns the most recent turns in chronological order', async () => {
    if (!dbOk) return;
    const h = await loadHistory(id('CONV'), 20);
    expect(h).toHaveLength(20);
    // Should end with the newest message (msg 24), not start with msg 0.
    expect(h[h.length - 1]!.content).toBe('msg 24');
    expect(h[0]!.content).toBe('msg 5'); // 25 msgs, last 20 → starts at msg 5
  });

  it('keeps a same-millisecond user/assistant pair in order', async () => {
    if (!dbOk) return;
    const convo = await prisma.conversation.create({
      data: { id: id('PAIR'), circleId: id('C'), channel: 'voice' },
    });
    // Ten turns written the way the channels write them; a flipped pair would
    // make the model re-execute the previous request (seen as duplicate events).
    for (let i = 0; i < 10; i++) await appendMessages(convo.id, `q${i}`, `a${i}`);
    const h = await loadHistory(convo.id, 20);
    expect(h.map((m) => m.role)).toEqual(Array.from({ length: 10 }).flatMap(() => ['user', 'assistant']));
    expect(h[h.length - 1]!.content).toBe('a9');
    // Same-timestamp rows (as a raw createMany would produce) still order by id.
    const at = new Date();
    await prisma.message.createMany({
      data: [
        { conversationId: convo.id, role: 'user', content: 'tie-q', createdAt: at },
        { conversationId: convo.id, role: 'assistant', content: 'tie-a', createdAt: at },
      ],
    });
    const h2 = await loadHistory(convo.id, 2);
    expect(h2.map((m) => m.content)).toEqual(['tie-q', 'tie-a']);
    await prisma.message.deleteMany({ where: { conversationId: convo.id } });
    await prisma.conversation.delete({ where: { id: convo.id } });
  });
});

describe('listPendingProposals', () => {
  it('excludes a stale backlog and expires it', async () => {
    if (!dbOk) return;
    const before = await listPendingProposals(id('C'));
    expect(before.map((p) => p.title)).toEqual(['Fresh']); // Stale excluded
    const expired = await expireStaleProposals(id('C'));
    expect(expired).toBe(1);
    const stale = await prisma.emailProposal.findFirst({ where: { circleId: id('C'), code: '2' } });
    expect(stale?.status).toBe('expired');
  });
});
