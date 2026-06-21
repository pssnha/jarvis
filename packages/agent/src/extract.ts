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

// ---------------------------------------------------------------------------
// Email analysis: classify a polled email into reminder / event / vacation
// proposals (awaiting WhatsApp confirmation before anything is created).
// ---------------------------------------------------------------------------

export type ProposalKind = 'reminder' | 'event' | 'vacation';

/** A vacation item drafted from an email (flight/hotel/etc.). */
export interface VacationItemDraft {
  type: 'activity' | 'flight' | 'hotel' | 'transport' | 'meal' | 'note';
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
  provider?: string;
  number?: string;
  fromLabel?: string;
  toLabel?: string;
  fromTimezone?: string;
  toTimezone?: string;
  seat?: string;
  confirmation?: string;
}

export interface VacationDraft {
  title: string;
  destinations?: string;
  startDate: string;
  endDate: string;
  /** IANA timezone of the destination; the trip is shown in this zone. */
  timezone?: string;
  item?: VacationItemDraft;
}

/** One detected, not-yet-created scheduling item from an email. */
export interface AnalyzedProposal {
  kind: ProposalKind;
  title: string;
  /** One-line human summary for the WhatsApp confirmation. */
  summary: string;
  /** For reminder/event. */
  draft?: EventDraft;
  /** For events: minutes before start to remind. */
  reminderLeadMinutes?: number;
  /** For vacation. */
  vacation?: VacationDraft;
}

const ANALYZE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      description:
        'Each distinct schedulable item the email implies. Empty array for marketing/newsletters/receipts with nothing to schedule.',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['reminder', 'event', 'vacation'],
            description:
              'reminder = a simple nudge with no hard time block (a bill due, a birthday, "renew X"). event = a real commitment that occupies time (an appointment, meeting, class). vacation = a trip, or a flight/hotel/travel booking.',
          },
          title: { type: 'string', description: 'Short title.' },
          summary: {
            type: 'string',
            description:
              'One concise line a human reads to decide yes/no, e.g. "Dentist appt — Tue 12 Jun 9:00am".',
          },
          event: {
            type: 'object',
            description: 'Provide ONLY for kind reminder or event.',
            properties: {
              start: {
                type: 'string',
                description: 'Local ISO without offset "2026-06-10T15:00", or date only for all-day.',
              },
              end: { type: 'string' },
              all_day: { type: 'boolean' },
              location: { type: 'string' },
              category: { type: 'string', enum: EVENT_CATEGORIES },
              remind_lead_minutes: {
                type: 'integer',
                description: 'For an event: minutes before start to send the reminder.',
              },
              recurrence: {
                type: 'object',
                description: 'Only if it clearly repeats.',
                properties: {
                  freq: { type: 'string', enum: RECURRENCE_FREQS },
                  interval: { type: 'integer' },
                  byweekday: { type: 'array', items: { type: 'string', enum: WEEKDAYS } },
                  count: { type: 'integer' },
                  until: { type: 'string' },
                },
                required: ['freq'],
              },
            },
            required: ['start'],
          },
          vacation: {
            type: 'object',
            description: 'Provide ONLY for kind vacation.',
            properties: {
              title: { type: 'string', description: 'Trip title, e.g. "Lisbon trip".' },
              destinations: { type: 'string', description: 'Comma-separated cities.' },
              start_date: { type: 'string', description: 'Trip start date "YYYY-MM-DD".' },
              end_date: { type: 'string', description: 'Trip end date "YYYY-MM-DD".' },
              timezone: {
                type: 'string',
                description:
                  'IANA timezone of the primary destination, inferred from the city/country, e.g. "America/Edmonton" for Banff, "America/Detroit" for Detroit, "Asia/Kolkata" for Mumbai. The trip\'s times are shown in this zone.',
              },
              item: {
                type: 'object',
                description: 'The booking this email represents, if any.',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['activity', 'flight', 'hotel', 'transport', 'meal', 'note'],
                  },
                  title: { type: 'string' },
                  starts_at: { type: 'string', description: 'Local ISO (flight=departure, hotel=check-in).' },
                  ends_at: { type: 'string', description: 'Local ISO (flight=arrival, hotel=check-out).' },
                  location: { type: 'string' },
                  provider: { type: 'string', description: 'Airline / hotel / company.' },
                  number: { type: 'string', description: 'Flight or booking number.' },
                  from_label: { type: 'string', description: 'Departure airport / pickup.' },
                  to_label: { type: 'string', description: 'Arrival airport / dropoff.' },
                  from_timezone: {
                    type: 'string',
                    description:
                      'For flights/transport: IANA timezone of the departure point (starts_at is its local time).',
                  },
                  to_timezone: {
                    type: 'string',
                    description:
                      'For flights/transport: IANA timezone of the arrival point (ends_at is its local time) — so arrival shows in destination time, not origin.',
                  },
                  seat: { type: 'string', description: 'Seat / room.' },
                  confirmation: { type: 'string', description: 'PNR / confirmation code.' },
                },
                required: ['type', 'title', 'starts_at'],
              },
            },
            required: ['title', 'start_date', 'end_date'],
          },
        },
        required: ['kind', 'title', 'summary'],
      },
    },
  },
  required: ['proposals'],
};

export interface AnalyzeEmailOptions {
  text: string;
  subject?: string;
  timezone: string;
  /** Circle this email belongs to (for usage billing). */
  circleId?: string;
}

/** Classify an email into reminder/event/vacation proposals (nothing is created here). */
export async function analyzeEmail(opts: AnalyzeEmailOptions): Promise<AnalyzedProposal[]> {
  const system = `You triage emails sent to a shared family's scheduling assistant. Decide what, if anything, should go on the schedule.
Right now it is ${describeNow(opts.timezone)} in the time zone (${opts.timezone}).
Resolve relative dates against that and return local wall-clock times without a timezone offset.

Capture as proposals:
- event: a real, time-bound commitment — appointment, meeting, class, school event, test, party, reservation.
- reminder: a dated nudge with no hard time block — a bill due, a birthday, "renew X", a deadline.
- vacation: ANY trip or travel booking — flights, hotels, car rentals, tours, cruises, itineraries, or
  "your trip/booking is confirmed" emails — EVEN when the email looks like a receipt, statement, or
  confirmation, or comes from a bank, credit card, airline, hotel, or booking site. Extract the
  destination and dates, and capture the specific booking (flight/hotel/etc.) as the item with its
  times, confirmation number, and locations.

Return an empty list ONLY for pure marketing, promotions, newsletters, social/app notifications, and
security or login/password notices that carry no schedulable date or action. When an email clearly
describes travel, a date, or an action, prefer capturing it over ignoring it.`;

  const text = opts.subject ? `Email subject: ${opts.subject}\n\n${opts.text}` : opts.text;
  const args = await getProvider().extractStructured({
    system,
    text,
    toolName: 'record_proposals',
    schema: ANALYZE_SCHEMA,
    circleId: opts.circleId,
    source: 'email',
  });

  const raw = (args as { proposals?: unknown }).proposals;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeProposal).filter((p): p is AnalyzedProposal => p !== null);
}

function str(o: Record<string, unknown>, k: string): string | undefined {
  return typeof o[k] === 'string' ? (o[k] as string) : undefined;
}

function normalizeProposal(input: unknown): AnalyzedProposal | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const kind = o.kind;
  const title = str(o, 'title');
  const summary = str(o, 'summary') ?? title;
  if ((kind !== 'reminder' && kind !== 'event' && kind !== 'vacation') || !title || !summary) {
    return null;
  }

  if (kind === 'vacation') {
    const v = (o.vacation ?? {}) as Record<string, unknown>;
    const startDate = str(v, 'start_date');
    const endDate = str(v, 'end_date') ?? startDate;
    if (!startDate) return null;
    const itemRaw = v.item as Record<string, unknown> | undefined;
    let item: VacationItemDraft | undefined;
    if (itemRaw && typeof itemRaw === 'object' && str(itemRaw, 'title') && str(itemRaw, 'starts_at')) {
      const t = str(itemRaw, 'type');
      item = {
        type: (t as VacationItemDraft['type']) ?? 'activity',
        title: str(itemRaw, 'title')!,
        startsAt: str(itemRaw, 'starts_at')!,
        endsAt: str(itemRaw, 'ends_at'),
        location: str(itemRaw, 'location'),
        provider: str(itemRaw, 'provider'),
        number: str(itemRaw, 'number'),
        fromLabel: str(itemRaw, 'from_label'),
        toLabel: str(itemRaw, 'to_label'),
        fromTimezone: str(itemRaw, 'from_timezone'),
        toTimezone: str(itemRaw, 'to_timezone'),
        seat: str(itemRaw, 'seat'),
        confirmation: str(itemRaw, 'confirmation'),
      };
    }
    return {
      kind,
      title,
      summary,
      vacation: {
        title: str(v, 'title') ?? title,
        destinations: str(v, 'destinations'),
        startDate,
        endDate: endDate ?? startDate,
        timezone: str(v, 'timezone'),
        item,
      },
    };
  }

  // reminder | event
  const ev = (o.event ?? {}) as Record<string, unknown>;
  const start = str(ev, 'start');
  if (!start) return null;
  const draft: EventDraft = {
    title,
    start,
    end: str(ev, 'end'),
    allDay: typeof ev.all_day === 'boolean' ? ev.all_day : undefined,
    location: str(ev, 'location'),
    category: (str(ev, 'category') as EventDraft['category']) ?? undefined,
    recurrence: parseRecurrence(ev.recurrence),
  };
  return {
    kind,
    title,
    summary,
    draft,
    reminderLeadMinutes:
      kind === 'event' && typeof ev.remind_lead_minutes === 'number'
        ? (ev.remind_lead_minutes as number)
        : undefined,
  };
}
