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
  await mk('4', eventProposal('4', 'Guitar class', '2026-07-31T07:30')); // day before trip (adjacent)
  const recurring: AnalyzedProposal = {
    kind: 'event',
    title: 'Weekly class',
    summary: 'Weekly class',
    draft: { title: 'Weekly class', start: '2026-08-03T07:30', end: '2026-08-03T08:30', recurrence: { freq: 'weekly' } },
  };
  await prisma.emailProposal.create({
    data: { circleId: id('C'), code: '5', kind: 'event', title: recurring.title, summary: recurring.summary, payload: JSON.stringify(recurring) },
  });
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

  it('does not pull an event adjacent to (but outside) a trip into it', async () => {
    if (!dbOk) return;
    await confirmProposal(id('C'), '4'); // Jul 31, trip starts Aug 1
    const evs = await prisma.event.count({ where: { circleId: id('C'), title: 'Guitar class' } });
    expect(evs).toBe(1);
    const items = await prisma.vacationItem.count({ where: { vacationId: id('V'), title: 'Guitar class' } });
    expect(items).toBe(0);
  });

  it('keeps a recurring event on the calendar even if it falls inside a trip', async () => {
    if (!dbOk) return;
    await confirmProposal(id('C'), '5'); // Aug 3 (inside trip) but recurring
    const evs = await prisma.event.count({ where: { circleId: id('C'), title: 'Weekly class' } });
    expect(evs).toBe(1);
    const items = await prisma.vacationItem.count({ where: { vacationId: id('V'), title: 'Weekly class' } });
    expect(items).toBe(0);
  });

  it('creates a trip in its destination timezone and interprets items there', async () => {
    if (!dbOk) return;
    const vac: AnalyzedProposal = {
      kind: 'vacation',
      title: 'Mumbai trip',
      summary: 'Mumbai trip',
      vacation: {
        title: 'Mumbai trip',
        destinations: 'Mumbai',
        startDate: '2026-12-19',
        endDate: '2026-12-26',
        timezone: 'Asia/Kolkata',
        item: { type: 'meal', title: 'Welcome dinner', startsAt: '2026-12-19T20:00' },
      },
    };
    await prisma.emailProposal.create({
      data: { circleId: id('C'), code: '3', kind: 'vacation', title: vac.title, summary: vac.summary, payload: JSON.stringify(vac) },
    });
    await confirmProposal(id('C'), '3');
    const trip = await prisma.vacation.findFirst({ where: { circleId: id('C'), title: 'Mumbai trip' } });
    expect(trip?.timezone).toBe('Asia/Kolkata');
    // 8pm IST = 14:30 UTC, not 8pm interpreted in the circle's Pacific zone.
    const item = await prisma.vacationItem.findFirst({ where: { vacationId: trip!.id, title: 'Welcome dinner' } });
    expect(item?.startsAt.toISOString()).toBe('2026-12-19T14:30:00.000Z');
  });
});
