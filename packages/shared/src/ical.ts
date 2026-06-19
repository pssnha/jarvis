export interface ICalEvent {
  uid: string;
  title: string;
  description?: string;
  start: Date;
  end?: Date;
  allDay?: boolean;
  location?: string;
  /** RFC 5545 RRULE value (without the "RRULE:" prefix) for recurring events. */
  rrule?: string;
  /** Original instants excluded from the series (moved into single-occurrence
   *  overrides) — emitted as EXDATE so subscribers don't show a ghost. */
  exdates?: Date[];
  /** When true, marks the event as free/available (TRANSP:TRANSPARENT). */
  transparent?: boolean;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}` +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Build a minimal, valid iCalendar (RFC 5545) document. Times are emitted in UTC. */
export function buildICalendar(calendarName: string, events: ICalEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Jarvis//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  // Deterministic DTSTAMP (epoch) keeps output stable across requests.
  const stamp = formatUtc(new Date(0));

  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}@jarvis`);
    lines.push(`DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDate(e.start)}`);
      if (e.end) lines.push(`DTEND;VALUE=DATE:${formatDate(e.end)}`);
    } else {
      lines.push(`DTSTART:${formatUtc(e.start)}`);
      if (e.end) lines.push(`DTEND:${formatUtc(e.end)}`);
    }
    if (e.rrule) {
      lines.push(`RRULE:${e.rrule}`);
      for (const ex of e.exdates ?? [])
        lines.push(e.allDay ? `EXDATE;VALUE=DATE:${formatDate(ex)}` : `EXDATE:${formatUtc(ex)}`);
    }
    lines.push(`TRANSP:${e.transparent ? 'TRANSPARENT' : 'OPAQUE'}`);
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
