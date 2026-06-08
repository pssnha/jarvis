import { EVENT_CATEGORIES, RECURRENCE_FREQS, WEEKDAYS, type EventDraft } from '@jarvis/shared';
import { describeNow } from './datetime';
import { getProvider } from './llm';
import type { JsonSchema } from './llm/schema';

const EXTRACT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      description: 'All distinct calendar events found. Empty array if there are none.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short event title.' },
          start: {
            type: 'string',
            description:
              'Local start in ISO without timezone offset, e.g. "2026-06-10T15:00". For an all-day event use a date only, "2026-06-10".',
          },
          end: { type: 'string', description: 'Optional local end in the same format.' },
          all_day: { type: 'boolean' },
          location: { type: 'string' },
          category: { type: 'string', enum: EVENT_CATEGORIES },
          recurrence: {
            type: 'object',
            description: 'Only if the event clearly repeats. Omit otherwise.',
            properties: {
              freq: { type: 'string', enum: RECURRENCE_FREQS },
              interval: { type: 'integer' },
              byweekday: { type: 'array', items: { type: 'string', enum: WEEKDAYS } },
              count: { type: 'integer' },
              until: { type: 'string', description: 'Local date "YYYY-MM-DD".' },
            },
            required: ['freq'],
          },
        },
        required: ['title', 'start'],
      },
    },
  },
  required: ['events'],
};

export interface ExtractOptions {
  text: string;
  timezone: string;
  /** Optional extra context, e.g. an email subject/sender line. */
  context?: string;
}

/** Use the configured LLM to pull structured events out of free text. */
export async function extractEvents(opts: ExtractOptions): Promise<EventDraft[]> {
  const system = `You extract calendar events from messages and forwarded emails for a shared group schedule.
Right now it is ${describeNow(opts.timezone)} in the group's time zone (${opts.timezone}).
Resolve relative dates ("tomorrow", "next Friday", "this weekend") against that, and return local
wall-clock times without a timezone offset. If the text contains no schedulable events, record an
empty list.`;

  const text = opts.context ? `${opts.context}\n\n${opts.text}` : opts.text;
  const args = await getProvider().extractStructured({
    system,
    text,
    toolName: 'record_events',
    schema: EXTRACT_SCHEMA,
  });

  const raw = (args as { events?: unknown }).events;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeDraft).filter((e): e is EventDraft => e !== null);
}

function normalizeDraft(e: unknown): EventDraft | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  if (typeof o.title !== 'string' || typeof o.start !== 'string') return null;
  return {
    title: o.title,
    start: o.start,
    end: typeof o.end === 'string' ? o.end : undefined,
    allDay: typeof o.all_day === 'boolean' ? o.all_day : undefined,
    location: typeof o.location === 'string' ? o.location : undefined,
    category:
      typeof o.category === 'string' ? (o.category as EventDraft['category']) : undefined,
    recurrence: parseRecurrence(o.recurrence),
  };
}

function parseRecurrence(input: unknown): EventDraft['recurrence'] {
  if (!input || typeof input !== 'object') return undefined;
  const o = input as Record<string, unknown>;
  if (typeof o.freq !== 'string') return undefined;
  return {
    freq: o.freq as NonNullable<EventDraft['recurrence']>['freq'],
    interval: typeof o.interval === 'number' ? o.interval : undefined,
    byweekday: Array.isArray(o.byweekday)
      ? (o.byweekday.filter((d) => typeof d === 'string') as NonNullable<
          EventDraft['recurrence']
        >['byweekday'])
      : undefined,
    count: typeof o.count === 'number' ? o.count : undefined,
    until: typeof o.until === 'string' ? o.until : undefined,
  };
}
