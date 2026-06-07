import { describe, it, expect } from 'vitest';
import { buildRRule, nextOccurrence, occurrencesBetween } from '@jarvis/agent';
import { buildICalendar } from '@jarvis/shared';

const TZ = 'America/Los_Angeles';

describe('buildRRule', () => {
  it('builds a weekly rule with weekdays and interval', () => {
    expect(buildRRule({ freq: 'weekly', interval: 2, byweekday: ['MO', 'WE'] }, TZ)).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    );
  });

  it('builds a simple daily rule', () => {
    expect(buildRRule({ freq: 'daily' }, TZ)).toBe('FREQ=DAILY');
  });

  it('adds COUNT and a UTC UNTIL', () => {
    const r = buildRRule({ freq: 'weekly', byweekday: ['FR'], count: 5 }, TZ);
    expect(r).toBe('FREQ=WEEKLY;BYDAY=FR;COUNT=5');
    expect(buildRRule({ freq: 'daily', until: '2026-12-31' }, TZ)).toContain('UNTIL=2027');
  });
});

describe('nextOccurrence', () => {
  it('finds the next weekly occurrence preserving local wall time', () => {
    // Anchor: Tue 2026-06-09 09:00 LA. Weekly on Tuesdays.
    const start = new Date('2026-06-09T16:00:00Z'); // 09:00 PDT
    const from = new Date('2026-06-10T00:00:00Z'); // after the first one
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=TU', start, TZ, from);
    expect(next).not.toBeNull();
    // Next Tuesday is 2026-06-16; 09:00 PDT == 16:00 UTC
    expect(next!.toISOString()).toBe('2026-06-16T16:00:00.000Z');
  });
});

describe('occurrencesBetween', () => {
  it('lists daily occurrences in a window', () => {
    const start = new Date('2026-06-09T16:00:00Z'); // 09:00 PDT
    const occ = occurrencesBetween(
      'FREQ=DAILY',
      start,
      TZ,
      new Date('2026-06-10T00:00:00Z'),
      new Date('2026-06-12T23:59:59Z'),
    );
    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-06-10T16:00:00.000Z',
      '2026-06-11T16:00:00.000Z',
      '2026-06-12T16:00:00.000Z',
    ]);
  });
});

describe('iCal RRULE', () => {
  it('emits an RRULE line for recurring events', () => {
    const ics = buildICalendar('Fam', [
      {
        uid: 'r1',
        title: 'Trash',
        start: new Date('2026-06-09T16:00:00Z'),
        rrule: 'FREQ=WEEKLY;BYDAY=TU',
      },
    ]);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU');
  });
});
