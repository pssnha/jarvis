import { DateTime } from 'luxon';
import { RRule, rrulestr } from 'rrule';
import type { Recurrence } from '@jarvis/shared';

/**
 * The `rrule` library computes on naive ("floating") dates. To stay correct
 * across DST we generate occurrences using the event's wall-clock time in the
 * group's zone, then convert each result back to a real UTC instant.
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** A real UTC instant -> a Date whose UTC fields hold the wall time in `tz`. */
function utcToFloating(utc: Date, tz: string): Date {
  const l = DateTime.fromJSDate(utc).setZone(tz);
  return new Date(Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second));
}

/** A floating Date (UTC fields = wall time in `tz`) -> the real UTC instant. */
function floatingToUtc(floating: Date, tz: string): Date {
  return DateTime.fromObject(
    {
      year: floating.getUTCFullYear(),
      month: floating.getUTCMonth() + 1,
      day: floating.getUTCDate(),
      hour: floating.getUTCHours(),
      minute: floating.getUTCMinutes(),
      second: floating.getUTCSeconds(),
    },
    { zone: tz },
  )
    .toUTC()
    .toJSDate();
}

function formatFloating(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Build an RFC 5545 RRULE value (no "RRULE:" prefix) from structured recurrence. */
export function buildRRule(rec: Recurrence, tz: string): string {
  const parts: string[] = [`FREQ=${rec.freq.toUpperCase()}`];
  if (rec.interval && rec.interval > 1) parts.push(`INTERVAL=${rec.interval}`);
  if (rec.byweekday && rec.byweekday.length > 0) {
    parts.push(`BYDAY=${rec.byweekday.join(',')}`);
  }
  if (rec.count && rec.count > 0) parts.push(`COUNT=${rec.count}`);
  if (rec.until) {
    const end = DateTime.fromISO(rec.until, { zone: tz }).endOf('day').toUTC();
    if (end.isValid) parts.push(`UNTIL=${end.toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
  }
  return parts.join(';');
}

function buildRule(rruleStr: string, startsAtUtc: Date, tz: string) {
  const dtstart = formatFloating(utcToFloating(startsAtUtc, tz));
  return rrulestr(`DTSTART:${dtstart}\nRRULE:${rruleStr}`);
}

/** Next occurrence at or after `from` (UTC), or null if the series has ended. */
export function nextOccurrence(
  rruleStr: string,
  startsAtUtc: Date,
  tz: string,
  from: Date,
  exclude?: Date[],
): Date | null {
  const rule = buildRule(rruleStr, startsAtUtc, tz);
  const skip = new Set((exclude ?? []).map((d) => d.getTime()));
  let cursor = utcToFloating(from, tz);
  // Walk forward past any instances detached into single-occurrence overrides.
  for (;;) {
    const occ = rule.after(cursor, true);
    if (!occ) return null;
    const utc = floatingToUtc(occ, tz);
    if (!skip.has(utc.getTime())) return utc;
    cursor = new Date(occ.getTime() + 1000);
  }
}

/** All occurrences in (after, before] as real UTC instants. `exclude` drops
 *  instants detached into single-occurrence overrides. */
export function occurrencesBetween(
  rruleStr: string,
  startsAtUtc: Date,
  tz: string,
  after: Date,
  before: Date,
  exclude?: Date[],
): Date[] {
  const rule = buildRule(rruleStr, startsAtUtc, tz);
  const occs = rule.between(utcToFloating(after, tz), utcToFloating(before, tz), true);
  const skip = new Set((exclude ?? []).map((d) => d.getTime()));
  return occs.map((o) => floatingToUtc(o, tz)).filter((d) => !skip.has(d.getTime()));
}

const FREQ_MAP: Record<string, Recurrence['freq']> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};

/** Parse an RRULE value back into a structured Recurrence (for the web form). */
export function parseRRule(rruleStr: string, tz: string): Recurrence | null {
  const parts: Record<string, string> = {};
  for (const p of rruleStr.split(';')) {
    const [k, v] = p.split('=');
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const freq = parts.FREQ ? FREQ_MAP[parts.FREQ.toUpperCase()] : undefined;
  if (!freq) return null;

  const rec: Recurrence = { freq };
  if (parts.INTERVAL) rec.interval = Number(parts.INTERVAL);
  if (parts.BYDAY) rec.byweekday = parts.BYDAY.split(',') as Recurrence['byweekday'];
  if (parts.COUNT) rec.count = Number(parts.COUNT);
  if (parts.UNTIL) {
    const dt = DateTime.fromFormat(parts.UNTIL, "yyyyMMdd'T'HHmmss'Z'", { zone: 'utc' }).setZone(tz);
    if (dt.isValid) rec.until = dt.toFormat('yyyy-MM-dd');
  }
  return rec;
}

/** Human-readable recurrence, e.g. "every week on Tuesday". */
export function describeRecurrence(rruleStr: string): string {
  try {
    return RRule.fromString(`RRULE:${rruleStr}`).toText();
  } catch {
    return 'repeating';
  }
}
