import { describe, it, expect } from 'vitest';
import { localIsoToUtc } from '@jarvis/agent';

describe('localIsoToUtc', () => {
  it('converts local wall-clock time in a zone to UTC', () => {
    // 2026-06-10 15:00 in New York (EDT, UTC-4) => 19:00 UTC
    const d = localIsoToUtc('2026-06-10T15:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-06-10T19:00:00.000Z');
  });

  it('handles a date-only (all-day) value', () => {
    const d = localIsoToUtc('2026-07-01', 'America/New_York');
    // Midnight local on Jul 1 (EDT) => 04:00 UTC
    expect(d.toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });
});
