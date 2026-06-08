import { Prisma, prisma, type Event } from '@jarvis/db';
import type { Channel, EventDraft, Recurrence } from '@jarvis/shared';
import { localIsoToUtc } from './datetime';
import { buildRRule, describeRecurrence, nextOccurrence, occurrencesBetween } from './recurrence';

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
}

export async function createEvent(input: CreateEventInput) {
  const { groupId, draft, source, timezone, sourceRef, rawText, createdById, assigneeId } = input;
  const allDay = draft.allDay ?? false;
  return prisma.event.create({
    data: {
      groupId,
      title: draft.title,
      startsAt: localIsoToUtc(draft.start, timezone),
      endsAt: draft.end ? localIsoToUtc(draft.end, timezone) : null,
      allDay,
      location: draft.location,
      category: draft.category,
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
}

export async function createRawEvent(input: RawEventInput) {
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
  category: string | null;
  location: string | null;
  assigneeName: string | null;
  maintainsName: string | null;
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
    const endRef = ev.endsAt ?? ev.startsAt;
    if (endRef < from) continue;
    out.push({
      eventId: ev.id,
      title: ev.title,
      start: ev.startsAt,
      end: ev.endsAt,
      allDay: ev.allDay,
      recurring: false,
      category: ev.category,
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
    const durationMs = ev.endsAt ? ev.endsAt.getTime() - ev.startsAt.getTime() : 0;
    for (const start of occurrencesBetween(ev.rrule, ev.startsAt, timezone, from, to)) {
      out.push({
        eventId: ev.id,
        title: ev.title,
        start,
        end: durationMs ? new Date(start.getTime() + durationMs) : null,
        allDay: ev.allDay,
        recurring: true,
        category: ev.category,
        location: ev.location,
        assigneeName: ev.assignee?.name ?? null,
        maintainsName: ev.maintainsGroup?.name ?? null,
      });
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}
