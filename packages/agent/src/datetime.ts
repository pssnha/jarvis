import { DateTime } from 'luxon';

/** Interpret a local wall-clock ISO string in `tz` and return a UTC Date. */
export function localIsoToUtc(localIso: string, tz: string): Date {
  const dt = DateTime.fromISO(localIso, { zone: tz });
  if (dt.isValid) return dt.toUTC().toJSDate();
  const fallback = DateTime.fromISO(localIso, { zone: 'utc' });
  return (fallback.isValid ? fallback : DateTime.utc()).toJSDate();
}

/** Current time in `tz` as a local ISO string (no offset), e.g. "2026-06-10T15:00". */
export function nowIsoInZone(tz: string): string {
  return DateTime.now().setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm");
}

/** Human-readable "now" for system prompts, e.g. "Wednesday, 10 June 2026 at 15:04 EDT". */
export function describeNow(tz: string): string {
  return DateTime.now().setZone(tz).toFormat("cccc, dd LLLL yyyy 'at' HH:mm ZZZZ");
}

/** Human-readable event time range rendered in `tz`. */
export function formatEventTime(
  start: Date,
  end: Date | null,
  allDay: boolean,
  tz: string,
): string {
  const s = DateTime.fromJSDate(start).setZone(tz);
  const e = end ? DateTime.fromJSDate(end).setZone(tz) : null;

  if (allDay) {
    if (e && !e.hasSame(s, 'day')) {
      return `${s.toFormat('ccc dd LLL')} – ${e.toFormat('ccc dd LLL yyyy')} (all day)`;
    }
    return `${s.toFormat('ccc dd LLL yyyy')} (all day)`;
  }

  if (e) {
    if (e.hasSame(s, 'day')) {
      return `${s.toFormat('ccc dd LLL yyyy, HH:mm')}–${e.toFormat('HH:mm')}`;
    }
    return `${s.toFormat('ccc dd LLL yyyy HH:mm')} – ${e.toFormat('ccc dd LLL yyyy HH:mm')}`;
  }

  return s.toFormat('ccc dd LLL yyyy, HH:mm');
}
