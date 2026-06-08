export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

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
  timeLabel: string;
  allDay: boolean;
  recurring: boolean;
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
}
