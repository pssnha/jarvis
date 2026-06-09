import { Prisma, prisma, type Event } from '@jarvis/db';
import type { Channel, EventDraft, Recurrence } from '@jarvis/shared';
import { localIsoToUtc } from './datetime';
import { buildRRule, describeRecurrence, nextOccurrence, occurrencesBetween } from './recurrence';

/** "reminder" (simple, non-blocking) or "event" (hard block, conflict-checked). */
export type EventKind = 'reminder' | 'event';

/** Reminder slots are rendered as a 30-minute "available" block. */
export const REMINDER_BLOCK_MINUTES = 30;

export interface CreateEventInput {
  groupId: string;
  draft: EventDraft;
  source: Channel;
  timezone: string;
  sourceRef?: string;
  rawText?: string;
  createdById?: string;
  assigneeId?: string | null;
  maintainsGroupId?: string | null;
  color?: string | null;
  kind?: EventKind;
  reminderLeadMinutes?: number | null;
}

export async function createEvent(input: CreateEventInput) {
  const { groupId, draft, source, timezone, sourceRef, rawText, createdById, assigneeId } = input;
  const allDay = draft.allDay ?? false;
  const kind: EventKind = input.kind ?? 'reminder';
  return prisma.event.create({
    data: {
      groupId,
      title: draft.title,
      startsAt: localIsoToUtc(draft.start, timezone),
      endsAt: draft.end ? localIsoToUtc(draft.end, timezone) : null,
      allDay,
      location: draft.location,
      category: draft.category,
      color: input.color ?? null,
      kind,
      reminderLeadMinutes: kind === 'event' ? (input.reminderLeadMinutes ?? null) : null,
      rrule: draft.recurrence ? buildRRule(draft.recurrence, timezone) : null,
      source,
      sourceRef,
      rawText,
      createdById,
      assigneeId: assigneeId ?? null,
      maintainsGroupId: input.maintainsGroupId ?? null,
    },
  });
}

/** Insert an event with already-resolved UTC times and an optional raw RRULE (used by importers). */
export interface RawEventInput {
  groupId: string;
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt?: Date | null;
  allDay?: boolean;
  location?: string | null;
  category?: string | null;
  rrule?: string | null;
  source: string;
  sourceRef?: string | null;
  assigneeId?: string | null;
  maintainsGroupId?: string | null;
  color?: string | null;
  kind?: EventKind;
  reminderLeadMinutes?: number | null;
}

export async function createRawEvent(input: RawEventInput) {
  const kind: EventKind = input.kind ?? 'reminder';
  return prisma.event.create({
    data: {
      groupId: input.groupId,
      title: input.title,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      allDay: input.allDay ?? false,
      location: input.location ?? null,
      category: input.category ?? null,
      color: input.color ?? null,
      kind,
      reminderLeadMinutes: kind === 'event' ? (input.reminderLeadMinutes ?? null) : null,
      rrule: input.rrule ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      assigneeId: input.assigneeId ?? null,
      maintainsGroupId: input.maintainsGroupId ?? null,
    },
  });
}

export async function getEvent(groupId: string, eventId: string) {
  return prisma.event.findFirst({ where: { id: eventId, groupId } });
}

export interface UpdateEventInput {
  title?: string;
  /** Local ISO start. */
  start?: string;
  /** Local ISO end, or null to clear. */
  end?: string | null;
  allDay?: boolean;
  location?: string | null;
  category?: string | null;
  /** Structured recurrence, or null to make it one-off. */
  recurrence?: Recurrence | null;
  /** Member id this event is for, or null to unassign. */
  assigneeId?: string | null;
  /** Hex color, or null to clear (use the category color). */
  color?: string | null;
  /** "reminder" or "event". */
  kind?: EventKind;
  /** For events: minutes before start to send the reminder (null = at start). */
  reminderLeadMinutes?: number | null;
}

export async function updateEvent(
  groupId: string,
  eventId: string,
  patch: UpdateEventInput,
  timezone: string,
) {
  const ev = await prisma.event.findFirst({ where: { id: eventId, groupId } });
  if (!ev) return null;

  const data: Prisma.EventUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.allDay !== undefined) data.allDay = patch.allDay;
  if (patch.location !== undefined) data.location = patch.location;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.start !== undefined) data.startsAt = localIsoToUtc(patch.start, timezone);
  if (patch.end !== undefined) {
    data.endsAt = patch.end ? localIsoToUtc(patch.end, timezone) : null;
  }
  if (patch.recurrence !== undefined) {
    data.rrule = patch.recurrence ? buildRRule(patch.recurrence, timezone) : null;
  }
  if (patch.assigneeId !== undefined) {
    data.assignee = patch.assigneeId
      ? { connect: { id: patch.assigneeId } }
      : { disconnect: true };
  }
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.kind !== undefined) data.kind = patch.kind;
  if (patch.reminderLeadMinutes !== undefined) {
    data.reminderLeadMinutes = patch.reminderLeadMinutes;
  }
  // A reminder never carries a lead time; clear it if switching away from event.
  const effectiveKind = (patch.kind ?? ev.kind) as EventKind;
  if (effectiveKind !== 'event') data.reminderLeadMinutes = null;

  return prisma.event.update({ where: { id: ev.id }, data });
}

export async function findEvents(groupId: string, query: string) {
  return prisma.event.findMany({
    where: { groupId, title: { contains: query } },
    orderBy: { startsAt: 'asc' },
    take: 10,
  });
}

export async function cancelEvent(groupId: string, eventId: string) {
  const ev = await prisma.event.findFirst({ where: { id: eventId, groupId } });
  if (!ev) return null;
  await prisma.event.delete({ where: { id: ev.id } });
  return ev;
}

export async function getGroup(groupId: string) {
  return prisma.group.findUnique({ where: { id: groupId } });
}

/** A schedule entry resolved to its next relevant time (handles recurrence). */
export interface ScheduleItem {
  event: Event;
  /** The effective upcoming time (next occurrence for recurring events). */
  when: Date;
  /** Human-readable recurrence, if the event repeats. */
  recurrence?: string;
  /** Name of the individual this event is for, if any. */
  assigneeName?: string | null;
}

/**
 * Upcoming schedule for a group: one-off events by start time, plus the next
 * occurrence of each recurring event, merged and sorted.
 */
export async function getSchedule(
  groupId: string,
  timezone: string,
  opts?: { from?: Date; to?: Date; limit?: number; memberId?: string },
): Promise<ScheduleItem[]> {
  const from = opts?.from ?? new Date();
  const items: ScheduleItem[] = [];
  const assigneeFilter = opts?.memberId ? { assigneeId: opts.memberId } : {};

  const include = { assignee: { select: { name: true } } } as const;

  // One-off events within the window.
  const oneOff = await prisma.event.findMany({
    where: {
      groupId,
      rrule: null,
      startsAt: { gte: from, ...(opts?.to ? { lte: opts.to } : {}) },
      ...assigneeFilter,
    },
    orderBy: { startsAt: 'asc' },
    include,
  });
  for (const ev of oneOff)
    items.push({ event: ev, when: ev.startsAt, assigneeName: ev.assignee?.name ?? null });

  // Recurring events: compute the next occurrence from `from`.
  const recurring = await prisma.event.findMany({
    where: { groupId, NOT: { rrule: null }, ...assigneeFilter },
    include,
  });
  for (const ev of recurring) {
    if (!ev.rrule) continue;
    const next = nextOccurrence(ev.rrule, ev.startsAt, timezone, from);
    if (!next) continue;
    if (opts?.to && next > opts.to) continue;
    items.push({
      event: ev,
      when: next,
      recurrence: describeRecurrence(ev.rrule),
      assigneeName: ev.assignee?.name ?? null,
    });
  }

  items.sort((a, b) => a.when.getTime() - b.when.getTime());
  return opts?.limit ? items.slice(0, opts.limit) : items;
}

/** A single calendar occurrence (recurring events expanded within a window). */
export interface Occurrence {
  eventId: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  recurring: boolean;
  kind: EventKind;
  category: string | null;
  color: string | null;
  location: string | null;
  assigneeName: string | null;
  maintainsName: string | null;
}

const REMINDER_MS = REMINDER_BLOCK_MINUTES * 60_000;

/** Effective end of an event for rendering/overlap: reminders get a 30-min block. */
function effectiveEnd(start: Date, end: Date | null, kind: string): Date | null {
  if (end) return end;
  if (kind === 'reminder') return new Date(start.getTime() + REMINDER_MS);
  return null;
}

/** Expand the schedule into individual occurrences within [from, to] for a calendar view. */
export async function expandCalendar(
  groupId: string,
  timezone: string,
  from: Date,
  to: Date,
  memberId?: string,
): Promise<Occurrence[]> {
  const out: Occurrence[] = [];
  const assigneeFilter = memberId ? { assigneeId: memberId } : {};
  const include = {
    assignee: { select: { name: true } },
    maintainsGroup: { select: { name: true } },
  } as const;

  const oneOff = await prisma.event.findMany({
    where: { groupId, rrule: null, startsAt: { lte: to }, ...assigneeFilter },
    include,
  });
  for (const ev of oneOff) {
    const end = effectiveEnd(ev.startsAt, ev.endsAt, ev.kind);
    const endRef = end ?? ev.startsAt;
    if (endRef < from) continue;
    out.push({
      eventId: ev.id,
      title: ev.title,
      start: ev.startsAt,
      end,
      allDay: ev.allDay,
      recurring: false,
      kind: ev.kind as EventKind,
      category: ev.category,
      color: ev.color,
      location: ev.location,
      assigneeName: ev.assignee?.name ?? null,
      maintainsName: ev.maintainsGroup?.name ?? null,
    });
  }

  const recurring = await prisma.event.findMany({
    where: { groupId, NOT: { rrule: null }, ...assigneeFilter },
    include,
  });
  for (const ev of recurring) {
    if (!ev.rrule) continue;
    const durationMs = ev.endsAt
      ? ev.endsAt.getTime() - ev.startsAt.getTime()
      : ev.kind === 'reminder'
        ? REMINDER_MS
        : 0;
    for (const start of occurrencesBetween(ev.rrule, ev.startsAt, timezone, from, to)) {
      out.push({
        eventId: ev.id,
        title: ev.title,
        start,
        end: durationMs ? new Date(start.getTime() + durationMs) : null,
        allDay: ev.allDay,
        recurring: true,
        kind: ev.kind as EventKind,
        category: ev.category,
        color: ev.color,
        location: ev.location,
        assigneeName: ev.assignee?.name ?? null,
        maintainsName: ev.maintainsGroup?.name ?? null,
      });
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

/** An existing event that overlaps a proposed time range. */
export interface Conflict {
  eventId: string;
  title: string;
  start: Date;
  end: Date;
}

const EVENT_DEFAULT_MS = 60 * 60_000;

/**
 * Find hard-block events (kind = "event") that overlap [start, end] in a group.
 * Reminders never conflict. Used to warn before scheduling a new event.
 */
export async function findConflicts(
  groupId: string,
  timezone: string,
  start: Date,
  end: Date,
  excludeEventId?: string,
): Promise<Conflict[]> {
  const out: Conflict[] = [];
  const idFilter = excludeEventId ? { id: { not: excludeEventId } } : {};

  const oneOff = await prisma.event.findMany({
    where: { groupId, kind: 'event', rrule: null, ...idFilter },
  });
  for (const ev of oneOff) {
    const s = ev.startsAt;
    const e = ev.endsAt ?? new Date(s.getTime() + EVENT_DEFAULT_MS);
    if (s < end && e > start) out.push({ eventId: ev.id, title: ev.title, start: s, end: e });
  }

  const recurring = await prisma.event.findMany({
    where: { groupId, kind: 'event', rrule: { not: null }, ...idFilter },
  });
  for (const ev of recurring) {
    if (!ev.rrule) continue;
    const durationMs = ev.endsAt ? ev.endsAt.getTime() - ev.startsAt.getTime() : EVENT_DEFAULT_MS;
    const windowStart = new Date(start.getTime() - durationMs);
    for (const occ of occurrencesBetween(ev.rrule, ev.startsAt, timezone, windowStart, end)) {
      const e = new Date(occ.getTime() + durationMs);
      if (occ < end && e > start) {
        out.push({ eventId: ev.id, title: ev.title, start: occ, end: e });
      }
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}
