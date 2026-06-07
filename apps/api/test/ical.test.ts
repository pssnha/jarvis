import { describe, it, expect } from 'vitest';
import { buildICalendar } from '@jarvis/shared';

describe('buildICalendar', () => {
  it('emits a VEVENT with a UTC start', () => {
    const ics = buildICalendar('Fam', [
      { uid: 'e1', title: 'Dentist', start: new Date('2026-06-10T15:00:00Z') },
    ]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Dentist');
    expect(ics).toContain('DTSTART:20260610T150000Z');
    expect(ics).toContain('END:VCALENDAR');
  });

  it('emits all-day events as VALUE=DATE', () => {
    const ics = buildICalendar('Fam', [
      { uid: 'e2', title: 'Trip', start: new Date('2026-07-01T00:00:00Z'), allDay: true },
    ]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260701');
  });

  it('escapes commas and semicolons in text', () => {
    const ics = buildICalendar('Fam', [
      { uid: 'e3', title: 'Dinner, then movie; fun', start: new Date('2026-06-10T15:00:00Z') },
    ]);
    expect(ics).toContain('SUMMARY:Dinner\\, then movie\\; fun');
  });
});
