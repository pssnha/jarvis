export * from './ical';

export const APP_NAME = 'jarvis';

/** The interfaces a schedule item can arrive through. */
export type Channel = 'web' | 'whatsapp' | 'email' | 'alexa';

export type EventCategory = 'appointment' | 'vacation' | 'reminder' | 'other';

export const EVENT_CATEGORIES: EventCategory[] = [
  'appointment',
  'vacation',
  'reminder',
  'other',
];

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export const RECURRENCE_FREQS: RecurrenceFreq[] = ['daily', 'weekly', 'monthly', 'yearly'];

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export const WEEKDAYS: Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/** Kind of an itinerary entry within a vacation. */
export type VacationItemType = 'activity' | 'flight' | 'hotel' | 'transport' | 'meal' | 'note';

export const VACATION_ITEM_TYPES: VacationItemType[] = [
  'activity',
  'flight',
  'hotel',
  'transport',
  'meal',
  'note',
];

/** A structured recurrence, converted to an RFC 5545 RRULE on save. */
export interface Recurrence {
  freq: RecurrenceFreq;
  /** Repeat every N periods (default 1). */
  interval?: number;
  /** Days of week for weekly recurrence, e.g. ["MO","WE","FR"]. */
  byweekday?: Weekday[];
  /** Stop after this many occurrences. */
  count?: number;
  /** Stop on/after this local date, e.g. "2026-12-31". */
  until?: string;
}

/**
 * A schedule item as extracted by the agent, before it is stored.
 * Date/time strings are LOCAL wall-clock ISO (no offset) — e.g. "2026-06-10T15:00".
 * They are interpreted in the group's time zone and converted to UTC on save.
 */
export interface EventDraft {
  title: string;
  /** Local ISO start, e.g. "2026-06-10T15:00" or "2026-06-10" for all-day. */
  start: string;
  /** Optional local ISO end. */
  end?: string;
  allDay?: boolean;
  location?: string;
  category?: EventCategory;
  /** Optional recurrence — makes this a repeating event/reminder. */
  recurrence?: Recurrence;
}

export type Role = 'user' | 'assistant';
