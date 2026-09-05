import '../src/loadEnv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@jarvis/db';
import {
  cancelEventOccurrence,
  createEvent,
  expandCalendar,
  findOccurrenceInstant,
  updateEventOccurrence,
} from '@jarvis/agent';

/**
 * Editing one instance of a recurring series must not touch the rest: it detaches
 * into a single-occurrence override, and the parent's expansion skips that instant.
 *
 * DB-gated: skipped when no database is reachable.
 */

const TZ = 'America/Los_Angeles';
const SUF = `occ_${Date.now()}`;
const id = (s: string) => `${SUF}_${s}`;

let dbOk = false;
let parentId = '';

const scope = { circleId: id('C'), kind: 'group' as const, groupId: id('G') };

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

  // Daily "Personal training" at 06:00 LA, starting Mon 2026-06-15.
  const ev = await createEvent({
    circleId: id('C'),
    groupId: id('G'),
    source: 'web',
    timezone: TZ,
    kind: 'event',
    draft: {
      title: 'Personal training',
      start: '2026-06-15T06:00',
      end: '2026-06-15T07:00',
      recurrence: { freq: 'daily' },
    },
  });
  parentId = ev.id;
});

afterAll(async () => {
  if (!dbOk) return;
  await prisma.event.deleteMany({ where: { circleId: id('C') } });
  await prisma.group.deleteMany({ where: { circleId: id('C') } });
  await prisma.circle.deleteMany({ where: { id: id('C') } });
  await prisma.$disconnect();
});

function titlesAt(from: Date, to: Date) {
  return expandCalendar(scope, TZ, from, to);
}

describe('single-occurrence edit', () => {
  it('moves only the chosen instance, leaving the series intact', async () => {
    if (!dbOk) return;
    const from = new Date('2026-06-15T00:00:00Z');
    const to = new Date('2026-06-19T23:59:59Z'); // Mon–Fri

    const before = await titlesAt(from, to);
    // 5 daily occurrences (Mon–Fri), all at 06:00 PDT (13:00 UTC).
    expect(before.length).toBe(5);
    expect(before.every((o) => o.start.toISOString().endsWith('13:00:00.000Z'))).toBe(true);

    // Move Thursday 06-18 to Friday 06-19 07:00.
    await updateEventOccurrence(
      id('C'),
      parentId,
      new Date('2026-06-18T13:00:00Z'), // original instant of the Thu occurrence
      { start: '2026-06-19T07:00', end: '2026-06-19T08:00' },
      TZ,
    );

    const after = await titlesAt(from, to);
    // Still 5 events total (4 from the series + 1 detached override).
    expect(after.length).toBe(5);
    const isos = after.map((o) => o.start.toISOString()).sort();
    // Thursday 06:00 is gone; Friday now has the original 06:00 plus the moved 07:00.
    expect(isos).not.toContain('2026-06-18T13:00:00.000Z');
    expect(isos).toContain('2026-06-19T13:00:00.000Z'); // Fri series occurrence
    expect(isos).toContain('2026-06-19T14:00:00.000Z'); // moved instance, 07:00 PDT

    // Re-editing the same instance updates the override (no duplicate row).
    await updateEventOccurrence(
      id('C'),
      parentId,
      new Date('2026-06-18T13:00:00Z'),
      { start: '2026-06-19T09:00', end: '2026-06-19T10:00' },
      TZ,
    );
    const overrides = await prisma.event.count({ where: { recurrenceParentId: parentId } });
    expect(overrides).toBe(1);
  });
});

describe('single-occurrence cancel', () => {
  it('skips only the chosen date, and the tombstone never shows', async () => {
    if (!dbOk) return;
    // Fresh weekly series to keep this isolated from the edit test above.
    const ev = await createEvent({
      circleId: id('C'),
      groupId: id('G'),
      source: 'web',
      timezone: TZ,
      kind: 'event',
      draft: {
        title: 'Sunday badminton',
        start: '2026-07-05T14:00', // Sun
        end: '2026-07-05T16:00',
        recurrence: { freq: 'weekly', byweekday: ['SU'] },
      },
    });
    const from = new Date('2026-07-05T00:00:00Z');
    const to = new Date('2026-07-20T00:00:00Z'); // 3 Sundays: 5, 12, 19

    const before = await expandCalendar(scope, TZ, from, to);
    const badmintonBefore = before.filter((o) => o.title === 'Sunday badminton');
    expect(badmintonBefore.length).toBe(3);

    // Resolve and cancel just Sunday 2026-07-12.
    const instant = await findOccurrenceInstant(id('C'), ev.id, '2026-07-12', TZ);
    expect(instant?.toISOString()).toBe('2026-07-12T21:00:00.000Z'); // 14:00 PDT
    await cancelEventOccurrence(id('C'), ev.id, instant!);

    const after = await expandCalendar(scope, TZ, from, to);
    const badmintonAfter = after.filter((o) => o.title === 'Sunday badminton');
    // One fewer occurrence, and the cancelled tombstone itself is not rendered.
    expect(badmintonAfter.length).toBe(2);
    const isos = badmintonAfter.map((o) => o.start.toISOString());
    expect(isos).not.toContain('2026-07-12T21:00:00.000Z');
    expect(isos).toContain('2026-07-05T21:00:00.000Z');
    expect(isos).toContain('2026-07-19T21:00:00.000Z');

    // Cancelling again is idempotent (updates the tombstone, no duplicate).
    await cancelEventOccurrence(id('C'), ev.id, instant!);
    const tombstones = await prisma.event.count({
      where: { recurrenceParentId: ev.id, cancelled: true },
    });
    expect(tombstones).toBe(1);
  });
});
