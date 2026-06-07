export * from './ical';

export const APP_NAME = 'jarvis';

/** The interfaces a schedule item can arrive through. */
export type Channel = 'web' | 'whatsapp' | 'email';

export type EventCategory = 'appointment' | 'vacation' | 'reminder' | 'other';

export const EVENT_CATEGORIES: EventCategory[] = [
  'appointment',
  'vacation',
  'reminder',
  'other',
];

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
}

export type Role = 'user' | 'assistant';
