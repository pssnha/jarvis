import { DateTime } from 'luxon';

/** A normalized event ready to be inserted (times already resolved to UTC). */
export interface ImportedEvent {
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  location?: string | null;
  category?: string | null;
  rrule?: string | null;
  sourceRef?: string | null;
}

export interface ImportResult {
  events: ImportedEvent[];
  skipped: number;
  errors: string[];
}

type Field = { kind: 'star' } | { kind: 'step'; n: number } | { kind: 'list'; vals: number[] };

function parseField(f: string): Field {
  if (f === '*') return { kind: 'star' };
  if (f.startsWith('*/')) return { kind: 'step', n: Number(f.slice(2)) };
  const vals: number[] = [];
  for (const part of f.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      for (let i = a!; i <= b!; i++) vals.push(i);
    } else {
      vals.push(Number(part));
    }
  }
  return { kind: 'list', vals };
}

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function dowToByday(n: number): string {
  return DOW[n === 7 ? 0 : n] ?? 'SU';
}

/** Convert a 5-field cron expression to an RFC 5545 RRULE value (no DTSTART). */
export function cronToRRule(expr: string): string | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [miS, hS, domS, monS, dowS] = f as [string, string, string, string, string];
  const mi = parseField(miS);
  const h = parseField(hS);
  const dom = parseField(domS);
  const mon = parseField(monS);
  const dow = parseField(dowS);

  // Sub-hour / sub-day step schedules.
  if (mi.kind === 'step' && h.kind === 'star') return `FREQ=MINUTELY;INTERVAL=${mi.n}`;
  if (h.kind === 'step') {
    const parts = [`FREQ=HOURLY`, `INTERVAL=${h.n}`];
    if (mi.kind === 'list') parts.push(`BYMINUTE=${mi.vals.join(',')}`);
    return parts.join(';');
  }

  const byhour = h.kind === 'list' ? `BYHOUR=${h.vals.join(',')}` : null;
  const byminute = mi.kind === 'list' ? `BYMINUTE=${mi.vals.join(',')}` : null;

  const parts: string[] = [];
  if (dow.kind === 'list') {
    parts.push('FREQ=WEEKLY', `BYDAY=${dow.vals.map(dowToByday).join(',')}`);
  } else if (dom.kind === 'step') {
    parts.push('FREQ=DAILY', `INTERVAL=${dom.n}`);
  } else if (dom.kind === 'list') {
    parts.push('FREQ=MONTHLY', `BYMONTHDAY=${dom.vals.join(',')}`);
  } else if (mon.kind === 'list') {
    parts.push('FREQ=YEARLY', `BYMONTH=${mon.vals.join(',')}`);
  } else {
    parts.push('FREQ=DAILY');
  }
  if (byhour) parts.push(byhour);
  if (byminute) parts.push(byminute);
  return parts.join(';');
}

function everyMsToRRule(ms: number): string | null {
  if (ms % 86_400_000 === 0) return `FREQ=DAILY;INTERVAL=${ms / 86_400_000}`;
  if (ms % 3_600_000 === 0) return `FREQ=HOURLY;INTERVAL=${ms / 3_600_000}`;
  if (ms % 60_000 === 0) return `FREQ=MINUTELY;INTERVAL=${ms / 60_000}`;
  return null;
}

function startOfTodayUtc(tz: string): Date {
  const dt = DateTime.now().setZone(tz).startOf('day');
  return (dt.isValid ? dt : DateTime.utc().startOf('day')).toUTC().toJSDate();
}

/**
 * Convert an openclaw schedules export (`openclaw.schedules.export.v1`) into
 * importable events. Cron/every become recurring; `at` becomes one-off.
 * Disabled jobs are skipped.
 */
export function openclawJobsToEvents(data: unknown, fallbackTz: string): ImportResult {
  const result: ImportResult = { events: [], skipped: 0, errors: [] };
  const jobs = (data as { jobs?: unknown[] })?.jobs;
  if (!Array.isArray(jobs)) {
    result.errors.push('No "jobs" array found.');
    return result;
  }

  for (const raw of jobs) {
    const job = raw as {
      id?: string;
      name?: string;
      enabled?: boolean;
      schedule?: { kind?: string; expr?: string; tz?: string; everyMs?: number; anchorMs?: number; at?: string };
      payload?: { message?: string; text?: string };
    };
    if (job.enabled === false) {
      result.skipped++;
      continue;
    }
    const sch = job.schedule ?? {};
    const tz = sch.tz || fallbackTz;
    const title = job.name?.trim() || 'Imported reminder';
    const description = job.payload?.message ?? job.payload?.text ?? null;

    try {
      if (sch.kind === 'cron' && sch.expr) {
        const rrule = cronToRRule(sch.expr);
        if (!rrule) {
          result.errors.push(`Unsupported cron "${sch.expr}" (${title})`);
          continue;
        }
        result.events.push({
          title,
          description,
          startsAt: startOfTodayUtc(tz),
          allDay: false,
          category: 'reminder',
          rrule,
          sourceRef: job.id ?? null,
        });
      } else if (sch.kind === 'every' && typeof sch.everyMs === 'number') {
        const rrule = everyMsToRRule(sch.everyMs);
        if (!rrule) {
          result.errors.push(`Unsupported interval for "${title}"`);
          continue;
        }
        result.events.push({
          title,
          description,
          startsAt: new Date(sch.anchorMs ?? Date.now()),
          allDay: false,
          category: 'reminder',
          rrule,
          sourceRef: job.id ?? null,
        });
      } else if (sch.kind === 'at' && sch.at) {
        result.events.push({
          title,
          description,
          startsAt: new Date(sch.at),
          allDay: false,
          category: 'reminder',
          rrule: null,
          sourceRef: job.id ?? null,
        });
      } else {
        result.errors.push(`Unsupported schedule for "${title}"`);
      }
    } catch (err) {
      result.errors.push(`Failed "${title}": ${(err as Error).message}`);
    }
  }

  return result;
}
