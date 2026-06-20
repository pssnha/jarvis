import '../src/loadEnv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@jarvis/db';
import { confirmProposal } from '@jarvis/agent';
import type { AnalyzedProposal } from '@jarvis/agent';

/**
 * A confirmed email reservation that falls inside a trip's dates must land on
 * that trip's itinerary; one outside any trip stays a calendar event.
 *
 * DB-gated: skipped when no database is reachable.
 */

const TZ = 'America/Los_Angeles';
const SUF = `prop_${Date.now()}`;
const id = (s: string) => `${SUF}_${s}`;

let dbOk = false;

function eventProposal(code: string, title: string, startLocal: string): AnalyzedProposal {
  return { kind: 'event', title, summary: title, draft: { title, start: startLocal, end: startLocal } };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
    return;
  }
  await prisma.circle.create({ data: { id: id('C'), name: id('Circle'), timezone: TZ } });
  await prisma.group.create({ data: { id: id('G'), circleId: id('C'), name: 'Home' } });
  // A trip Aug 1–7 (stored as midnight PDT = 07:00 UTC).
  await prisma.vacation.create({
    data: {
      id: id('V'),
      circleId: id('C'),
      title: 'Test Trip',
      startDate: new Date('2026-08-01T07:00:00Z'),
      endDate: new Date('2026-08-07T07:00:00Z'),
    },
  });
  const mk = (code: string, p: AnalyzedProposal) =>
    prisma.emailProposal.create({
      data: { circleId: id('C'), code, kind: p.kind, title: p.title, summary: p.summary, payload: JSON.stringify(p) },
    });
  await mk('1', eventProposal('1', 'Dinner at Test Bistro', '2026-08-03T19:00')); // inside trip
  await mk('2', eventProposal('2', 'Dentist appointment', '2026-09-15T09:00')); // outside any trip
});

afterAll(async () => {
  if (!dbOk) return;
  await prisma.vacationItem.deleteMany({ where: { vacationId: id('V') } });
  await prisma.vacation.deleteMany({ where: { circleId: id('C') } });
  await prisma.event.deleteMany({ where: { circleId: id('C') } });
  await prisma.emailProposal.deleteMany({ where: { circleId: id('C') } });
  await prisma.group.deleteMany({ where: { circleId: id('C') } });
  await prisma.circle.deleteMany({ where: { id: id('C') } });
  await prisma.$disconnect();
});

describe('email reservation routing', () => {
  it('attaches a reservation inside a trip to that trip', async () => {
    if (!dbOk) return;
    const msg = await confirmProposal(id('C'), '1');
    expect(msg).toContain('Test Trip');
    const items = await prisma.vacationItem.findMany({ where: { vacationId: id('V') } });
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Dinner at Test Bistro');
    expect(items[0]!.type).toBe('meal');
    // It should NOT also become a calendar event.
    const evs = await prisma.event.count({ where: { circleId: id('C'), title: 'Dinner at Test Bistro' } });
    expect(evs).toBe(0);
  });

  it('keeps a reservation outside any trip as a calendar event', async () => {
    if (!dbOk) return;
    await confirmProposal(id('C'), '2');
    const evs = await prisma.event.count({ where: { circleId: id('C'), title: 'Dentist appointment' } });
    expect(evs).toBe(1);
    const items = await prisma.vacationItem.count({ where: { vacationId: id('V'), title: 'Dentist appointment' } });
    expect(items).toBe(0);
  });
});
