import { describe, it, expect } from 'vitest';
import { cronToRRule, isMaintenanceText, openclawJobsToEvents } from '@jarvis/agent';

describe('isMaintenanceText', () => {
  it('flags maintenance/poller/health-check tasks', () => {
    expect(isMaintenanceText('Maintenance: family inbox poller (private)')).toBe(true);
    expect(isMaintenanceText('Maintenance: 6:00 AM group chat health check')).toBe(true);
    expect(isMaintenanceText('Email poll', 'run check_gmail_forwarded.py')).toBe(true);
  });
  it('does not flag normal reminders', () => {
    expect(isMaintenanceText('Karate reminder (Mondays 30m before)')).toBe(false);
    expect(isMaintenanceText('Vinit math class reminder')).toBe(false);
    expect(isMaintenanceText('Smitha dental appointment tomorrow')).toBe(false);
  });
});

describe('cronToRRule', () => {
  it('weekly on a weekday with time', () => {
    expect(cronToRRule('30 17 * * 0')).toBe('FREQ=WEEKLY;BYDAY=SU;BYHOUR=17;BYMINUTE=30');
  });
  it('daily at one time', () => {
    expect(cronToRRule('0 7 * * *')).toBe('FREQ=DAILY;BYHOUR=7;BYMINUTE=0');
  });
  it('daily at multiple hours', () => {
    expect(cronToRRule('0 9,13,18 * * *')).toBe('FREQ=DAILY;BYHOUR=9,13,18;BYMINUTE=0');
  });
  it('every N minutes', () => {
    expect(cronToRRule('*/15 * * * *')).toBe('FREQ=MINUTELY;INTERVAL=15');
  });
  it('every N hours at minute 0', () => {
    expect(cronToRRule('0 */4 * * *')).toBe('FREQ=HOURLY;INTERVAL=4;BYMINUTE=0');
  });
  it('day-of-month step', () => {
    expect(cronToRRule('0 6 */3 * *')).toBe('FREQ=DAILY;INTERVAL=3;BYHOUR=6;BYMINUTE=0');
  });
});

describe('openclawJobsToEvents', () => {
  it('maps cron/at/every and skips disabled', () => {
    const data = {
      jobs: [
        {
          id: 'a',
          name: 'Karate',
          enabled: true,
          schedule: { kind: 'cron', expr: '0 18 * * 1', tz: 'America/Los_Angeles' },
          payload: { text: 'Karate at 6:30' },
        },
        { id: 'b', name: 'Off', enabled: false, schedule: { kind: 'cron', expr: '0 7 * * *' } },
        { id: 'c', name: 'Dental', enabled: true, schedule: { kind: 'at', at: '2026-07-17T00:00:00.000Z' } },
        { id: 'd', name: 'Groomer', enabled: true, schedule: { kind: 'every', everyMs: 1814400000, anchorMs: 1777482000000 } },
      ],
    };
    const r = openclawJobsToEvents(data, 'America/Los_Angeles');
    expect(r.skipped).toBe(1);
    expect(r.events).toHaveLength(3);
    const karate = r.events.find((e) => e.title === 'Karate')!;
    expect(karate.rrule).toBe('FREQ=WEEKLY;BYDAY=MO;BYHOUR=18;BYMINUTE=0');
    const dental = r.events.find((e) => e.title === 'Dental')!;
    expect(dental.rrule).toBeNull();
    const groomer = r.events.find((e) => e.title === 'Groomer')!;
    expect(groomer.rrule).toBe('FREQ=DAILY;INTERVAL=21');
  });
});
