export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
export type EventKind = 'reminder' | 'event';
export type VacationItemType = 'activity' | 'flight' | 'hotel' | 'transport' | 'meal' | 'note';

export interface Conflict {
  eventId: string;
  title: string;
  timeLabel: string;
}

export interface Recurrence {
  freq: RecurrenceFreq;
  interval?: number;
  byweekday?: Weekday[];
  count?: number;
  until?: string;
}

export interface MemberLite {
  id: string;
  name: string | null;
}

export interface GroupSummary {
  id: string;
  name: string;
  timezone: string;
  icalToken: string;
  whatsappGroupId: string | null;
  members: MemberLite[];
}

export interface CalendarOccurrence {
  eventId: string;
  title: string;
  dateKey: string; // yyyy-MM-dd in the group's zone
  startLocal: string;
  endLocal: string | null;
  timeLabel: string;
  allDay: boolean;
  recurring: boolean;
  kind: EventKind;
  category: string | null;
  color: string | null;
  location: string | null;
  assigneeName: string | null;
  maintainsName: string | null;
}

export interface EventDetail {
  id: string;
  title: string;
  startLocal: string;
  endLocal: string | null;
  allDay: boolean;
  location: string | null;
  category: string | null;
  recurrence: Recurrence | null;
  assigneeId: string | null;
  color: string | null;
  kind: EventKind;
  reminderLeadMinutes: number | null;
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'member';
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  waId: string | null;
}

export interface AdminGroup {
  id: string;
  name: string;
  timezone: string;
  whatsappGroupId: string | null;
  inviteLink: string | null;
  icalToken: string;
  _count?: { members: number; events: number };
}

export interface WhatsAppGroup {
  id: string;
  subject: string;
}

export interface WhatsAppStatus {
  status: string; // offline | connecting | qr | open | closed | logged_out
  qr: string | null; // data URL
  self: string | null;
  groups: WhatsAppGroup[];
}

export interface GroupMember {
  id: string;
  name: string | null;
  email: string | null;
  waId: string | null;
}

export interface GroupEmailConfig {
  address: string | null;
  host: string | null;
  port: number | null;
  enabled: boolean;
  hasCredential: boolean;
  firstScanDone: boolean;
  lastPolledAt: string | null;
}

export interface EventPayload {
  title: string;
  start: string;
  end?: string | null;
  allDay?: boolean;
  location?: string | null;
  category?: string | null;
  recurrence?: Recurrence | null;
  assigneeId?: string | null;
  color?: string | null;
  kind?: EventKind;
  reminderLeadMinutes?: number | null;
}

// ---------- Vacations ----------

export interface TravelerLite {
  id: string;
  name: string | null;
}

export interface VacationSummary {
  id: string;
  title: string;
  destinations: string | null;
  timezone: string;
  startDateLocal: string;
  endDateLocal: string;
  dateRangeLabel: string;
  itemCount: number;
  travelers: TravelerLite[];
}

export interface ItineraryItem {
  id: string;
  type: VacationItemType;
  title: string;
  dateKey: string;
  startLocal: string;
  endLocal: string | null;
  timeLabel: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  confirmation: string | null;
  provider: string | null;
  number: string | null;
  fromLabel: string | null;
  toLabel: string | null;
  seat: string | null;
  phone: string | null;
  cost: string | null;
  color: string | null;
}

export interface ItineraryDay {
  dateKey: string;
  items: ItineraryItem[];
}

export interface VacationDetail extends VacationSummary {
  description: string | null;
  itinerary: ItineraryDay[];
  flights: ItineraryItem[];
  hotels: ItineraryItem[];
}

export interface VacationPayload {
  title: string;
  destinations?: string | null;
  startDate: string;
  endDate: string;
  timezone?: string | null;
  description?: string | null;
  travelerIds?: string[];
}

export interface VacationItemPayload {
  type: VacationItemType;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
  confirmation?: string | null;
  provider?: string | null;
  number?: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  seat?: string | null;
  phone?: string | null;
  cost?: string | null;
  color?: string | null;
}
