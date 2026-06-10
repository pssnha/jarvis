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

/** A WhatsApp group within a circle (a shared calendar). */
export interface CircleGroup {
  id: string;
  name: string;
  icalToken: string;
  whatsappGroupId: string | null;
}

/** A circle the signed-in user can see (Calendar / Vacations / Chat picker). */
export interface Circle {
  id: string;
  name: string;
  timezone: string;
  groups: CircleGroup[];
  members: MemberLite[];
}

export interface CalendarOccurrence {
  eventId: string;
  title: string;
  dateKey: string; // yyyy-MM-dd in the circle's zone
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
  /** True for a private (individual) event — has no group. */
  isPrivate: boolean;
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
  /** Circles this user is a per-circle admin of (empty for site admins). */
  adminCircleIds: string[];
}

export interface CircleAdminUser {
  id: string;
  email: string;
  name: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  waId: string | null;
}

export interface CircleEmailConfig {
  address: string | null;
  host: string | null;
  port: number | null;
  enabled: boolean;
  hasCredential: boolean;
  firstScanDone: boolean;
  lastPolledAt: string | null;
}

export interface EmailPoll {
  ranAt: string;
  scanned: number;
  found: number;
  error: string | null;
}

export interface EmailActivityItem {
  id: string;
  kind: string; // reminder | event | vacation
  title: string;
  summary: string;
  fromEmail: string | null;
  subject: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
}

export interface EmailActivity {
  polls: EmailPoll[];
  items: EmailActivityItem[];
}

export interface EmailConfirmResult {
  message: string;
  /** When an item could belong to more than one trip, the user must choose. */
  needsChoice?: {
    proposalId: string;
    summary: string;
    options: { target: string; label: string }[];
  };
}

export interface AdminCircleGroup {
  id: string;
  name: string;
  whatsappGroupId: string | null;
  icalToken: string;
  memberIds: string[];
}

export type CircleMemberRole = 'member' | 'circle_admin';

export interface AdminCircleMember {
  id: string;
  name: string | null;
  email: string | null;
  waId: string | null;
  role: CircleMemberRole;
}

/** A maintenance job that can be muted per circle. */
export type MaintenanceJob = 'email_poll' | 'daily_brief' | 'health_check';

export interface MaintenanceCell {
  date: string; // yyyy-MM-dd (UTC)
  job: string;
  runs: number;
  found: number;
  errors: number;
}

export interface MaintenanceSchedule {
  job: string;
  label: string;
  cadence: string;
}

export interface MaintenanceRunRow {
  job: string;
  ranAt: string;
  ok: boolean;
  circle: string | null;
  summary: string;
}

export interface AdminCircle {
  id: string;
  name: string;
  timezone: string;
  waSelf: string | null;
  coverImageUrl: string | null;
  email: CircleEmailConfig;
  mutedJobs: MaintenanceJob[];
  counts: { events: number; vacations: number };
  groups: AdminCircleGroup[];
  members: AdminCircleMember[];
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
  /** Target: a group (shared) or a member (private). Omit → circle primary group. */
  groupId?: string | null;
  ownerMemberId?: string | null;
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
  coverImageUrl: string | null;
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
  fromTimezone: string | null;
  toTimezone: string | null;
  departLabel: string | null;
  arriveLabel: string | null;
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
  fromTimezone?: string | null;
  toTimezone?: string | null;
  seat?: string | null;
  phone?: string | null;
  cost?: string | null;
  color?: string | null;
}
