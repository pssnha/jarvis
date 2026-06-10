import '../src/loadEnv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@jarvis/db';
import { expandCalendar } from '@jarvis/agent';

/**
 * Proves the two core privacy guarantees against a real database:
 *   1. private (individual) events are visible only to their owner;
 *   2. nothing crosses circles, even for the same person (same waHash) who is a
 *      member of two circles.
 *
 * DB-gated: if no database is reachable (e.g. bare CI without MySQL), every case
 * is skipped rather than failing.
 */

const TZ = 'America/Los_Angeles';
const SUF = `iso_${Date.now()}`;
const id = (s: string) => `${SUF}_${s}`;

let dbOk = false;

// A near-future window the fixture events fall into.
const start = new Date(Date.now() + 3 * 86_400_000);
function at(hoursFromStart: number): Date {
  return new Date(start.getTime() + hoursFromStart * 3_600_000);
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
    return;
  }

  // Circle A: member X (in group G) + member Y (not in G).
  await prisma.circle.create({ data: { id: id('A'), name: id('Circle A'), timezone: TZ } });
  await prisma.circle.create({ data: { id: id('B'), name: id('Circle B'), timezone: TZ } });

  await prisma.member.create({ data: { id: id('X'), circleId: id('A'), name: 'X', waHash: id('hashX') } });
  await prisma.member.create({ data: { id: id('Y'), circleId: id('A'), name: 'Y', waHash: id('hashY') } });
  // Same person (same waHash) but a member of circle B — must stay isolated.
  await prisma.member.create({ data: { id: id('X2'), circleId: id('B'), name: 'X', waHash: id('hashX') } });

  await prisma.group.create({
    data: { id: id('G'), circleId: id('A'), name: 'G', whatsappGroupId: id('wa_G'), icalToken: id('ical_G') },
  });
  await prisma.groupMember.create({ data: { groupId: id('G'), memberId: id('X') } });

  // Circle A events.
  await prisma.event.create({
    data: { id: id('ev_group'), circleId: id('A'), groupId: id('G'), title: 'A group event', startsAt: at(1), kind: 'event', source: 'web' },
  });
  await prisma.event.create({
    data: { id: id('ev_xpriv'), circleId: id('A'), ownerMemberId: id('X'), title: 'A X private', startsAt: at(2), kind: 'reminder', source: 'web' },
  });
  await prisma.event.create({
    data: { id: id('ev_ypriv'), circleId: id('A'), ownerMemberId: id('Y'), title: 'A Y private', startsAt: at(3), kind: 'reminder', source: 'web' },
  });
  // Circle B event owned by the same-person member.
  await prisma.event.create({
    data: { id: id('ev_b'), circleId: id('B'), ownerMemberId: id('X2'), title: 'B X private', startsAt: at(4), kind: 'reminder', source: 'web' },
  });
});

afterAll(async () => {
  if (!dbOk) return;
  await prisma.event.deleteMany({ where: { circleId: { in: [id('A'), id('B')] } } });
  await prisma.groupMember.deleteMany({ where: { groupId: id('G') } });
  await prisma.group.deleteMany({ where: { circleId: id('A') } });
  await prisma.member.deleteMany({ where: { circleId: { in: [id('A'), id('B')] } } });
  await prisma.circle.deleteMany({ where: { id: { in: [id('A'), id('B')] } } });
  await prisma.$disconnect();
});

async function titles(scope: Parameters<typeof expandCalendar>[0]): Promise<Set<string>> {
  const occ = await expandCalendar(scope, TZ, new Date(start.getTime() - 86_400_000), new Date(start.getTime() + 2 * 86_400_000));
  return new Set(occ.map((o) => o.title));
}

describe('circle + private isolation', () => {
  it("an individual sees their groups' events plus their own private items", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const t = await titles({ circleId: id('A'), kind: 'individual', memberId: id('X') });
    expect(t.has('A group event')).toBe(true); // X is in group G
    expect(t.has('A X private')).toBe(true); // own private
  });

  it("an individual never sees another member's private items", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const tx = await titles({ circleId: id('A'), kind: 'individual', memberId: id('X') });
    expect(tx.has('A Y private')).toBe(false);
    const ty = await titles({ circleId: id('A'), kind: 'individual', memberId: id('Y') });
    expect(ty.has('A X private')).toBe(false);
    expect(ty.has('A group event')).toBe(false); // Y is not in group G
    expect(ty.has('A Y private')).toBe(true);
  });

  it('a group view shows only shared events, never private ones', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const t = await titles({ circleId: id('A'), kind: 'group', groupId: id('G') });
    expect(t.has('A group event')).toBe(true);
    expect(t.has('A X private')).toBe(false);
    expect(t.has('A Y private')).toBe(false);
  });

  it('nothing crosses circles, even for the same person in two circles', async (ctx) => {
    if (!dbOk) return ctx.skip();
    const inA = await titles({ circleId: id('A'), kind: 'individual', memberId: id('X') });
    expect(inA.has('B X private')).toBe(false); // circle B item never leaks into A
    const inB = await titles({ circleId: id('B'), kind: 'individual', memberId: id('X2') });
    expect(inB.has('B X private')).toBe(true);
    expect(inB.has('A group event')).toBe(false);
    expect(inB.has('A X private')).toBe(false);
  });
});
