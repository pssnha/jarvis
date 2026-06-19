import { Prisma, prisma, type Event } from '@jarvis/db';
import type { Channel, EventDraft, Recurrence } from '@jarvis/shared';
import { localIsoToUtc } from './datetime';
import { buildRRule, describeRecurrence, nextOccurrence, occurrencesBetween } from './recurrence';
import { scopeWhere, type ScheduleScope } from './scope';

/** "reminder" (simple, non-blocking) or "event" (hard block, conflict-checked). */
export type EventKind = 'reminder' | 'event';

/** Reminder slots are rendered as a 30-minute "available" block. */
export const REMINDER_BLOCK_MINUTES = 30;

export interface CreateEventInput {
  circleId: string;
  /** Set for a shared group event; null/omitted for a private individual event. */
  groupId?: string | null;
  /** Owner of a private event (when groupId is null). */
  ownerMemberId?: string | null;
  draft: EventDraft;
  source: Channel;
  timezone: string;
  sourceRef?: string;
  rawText?: string;
  createdById?: string;
  assigneeId?: string | null;
  color?: string | null;
  kind?: EventKind;
  reminderLeadMinutes?: number | null;
}

export async function createEvent(input: CreateEventInput) {
  const { draft, source, timezone } = input;
  const allDay = draft.allDay ?? false;
  const kind: EventKind = input.kind ?? 'reminder';
  return prisma.event.create({
    data: {
      circleId: input.circleId,
      groupId: input.groupId ?? null,
      ownerMemberId: input.ownerMemberId ?? null,
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
      sourceRef: input.sourceRef,
      rawText: input.rawText,
      createdById: input.createdById,
      assigneeId: input.assigneeId ?? null,
    },
  });
}

/** Insert an event with already-resolved UTC times and an optional raw RRULE (importers). */
export interface RawEventInput {
  circleId: string;
  groupId?: string | null;
  ownerMemberId?: string | null;
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
  color?: string | null;
  kind?: EventKind;
  reminderLeadMinutes?: number | null;
}

export async function createRawEvent(input: RawEventInput) {
  const kind: EventKind = input.kind ?? 'reminder';
  return prisma.event.create({
    data: {
      circleId: input.circleId,
      groupId: input.groupId ?? null,
      ownerMemberId: input.ownerMemberId ?? null,
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
    },
  });
}

/** Single-event lookup is isolated by circle. */
export async function getEvent(circleId: string, eventId: string) {
  return prisma.event.findFirst({ where: { id: eventId, circleId } });
}

export interface UpdateEventInput {
  title?: string;
  start?: string;
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

export async function updateEvent(
  circleId: string,
  eventId: string,
  patch: UpdateEventInput,
  timezone: string,
) {
  const ev = await prisma.event.findFirst({ where: { id: eventId, circleId } });
  if (!ev) return null;

  const data: Prisma.EventUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.allDay !== undefined) data.allDay = patch.allDay;
  if (patch.location !== undefined) data.location = patch.location;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.start !== undefined) data.startsAt = localIsoToUtc(patch.start, timezone);
  if (patch.end !== undefined) data.endsAt = patch.end ? localIsoToUtc(patch.end, timezone) : null;
  if (patch.recurrence !== undefined) {
    data.rrule = patch.recurrence ? buildRRule(patch.recurrence, timezone) : null;
  }
  if (patch.assigneeId !== undefined) {
    data.assignee = patch.assigneeId ? { connect: { id: patch.assigneeId } } : { disconnect: true };
  }
  if (patch.color !== undefined) data.color = patch.color;
  if (patch.kind !== undefined) data.kind = patch.kind;
  if (patch.reminderLeadMinutes !== undefined) data.reminderLeadMinutes = patch.reminderLeadMinutes;
  const effectiveKind = (patch.kind ?? ev.kind) as EventKind;
  if (effectiveKind !== 'event') data.reminderLeadMinutes = null;

  return prisma.event.update({ where: { id: ev.id }, data });
}

/**
 * Edit a single instance of a recurring series without touching the rest:
 * detach it into a standalone override row (rrule null) that points back at the
 * parent via `recurrenceParentId`/`recurrenceStart`, so the parent's expansion
 * skips that instant. Re-editing the same instance updates the existing override.
 */
export async function updateEventOccurrence(
  circleId: string,
  parentId: string,
  occurrenceStartUtc: Date,
  patch: UpdateEventInput,
  timezone: string,
) {
  const parent = await prisma.event.findFirst({ where: { id: parentId, circleId } });
  if (!parent || !parent.rrule) return null;

  const startsAt =
    patch.start !== undefined ? localIsoToUtc(patch.start, timezone) : occurrenceStartUtc;
  let endsAt: Date | null;
  if (patch.end !== undefined) endsAt = patch.end ? localIsoToUtc(patch.end, timezone) : null;
  else if (parent.endsAt)
    endsAt = new Date(startsAt.getTime() + (parent.endsAt.getTime() - parent.startsAt.getTime()));
  else endsAt = null;

  const kind = (patch.kind ?? parent.kind) as EventKind;
  const fields = {
    title: patch.title ?? parent.title,
    startsAt,
    endsAt,
    allDay: patch.allDay ?? parent.allDay,
    location: patch.location !== undefined ? patch.location : parent.location,
    category: patch.category !== undefined ? patch.category : parent.category,
    color: patch.color !== undefined ? patch.color : parent.color,
    kind,
    reminderLeadMinutes:
      kind !== 'event'
        ? null
        : patch.reminderLeadMinutes !== undefined
          ? patch.reminderLeadMinutes
          : parent.reminderLeadMinutes,
    assigneeId: patch.assigneeId !== undefined ? patch.assigneeId : parent.assigneeId,
  };

  const existing = await prisma.event.findFirst({
    where: { recurrenceParentId: parentId, recurrenceStart: occurrenceStartUtc },
  });
  if (existing) return prisma.event.update({ where: { id: existing.id }, data: fields });
  return prisma.event.create({
    data: {
      ...fields,
      circleId: parent.circleId,
      groupId: parent.groupId,
      ownerMemberId: parent.ownerMemberId,
      source: parent.source,
      createdById: parent.createdById,
      rrule: null,
      recurrenceParentId: parent.id,
      recurrenceStart: occurrenceStartUtc,
    },
  });
}

/** Original instants of any single-occurrence overrides, grouped by parent id. */
export async function overridesByParent(parentIds: string[]): Promise<Map<string, Date[]>> {
  const map = new Map<string, Date[]>();
  if (parentIds.length === 0) return map;
  const rows = await prisma.event.findMany({
    where: { recurrenceParentId: { in: parentIds }, NOT: { recurrenceStart: null } },
    select: { recurrenceParentId: true, recurrenceStart: true },
  });
  for (const r of rows) {
    if (!r.recurrenceParentId || !r.recurrenceStart) continue;
    const arr = map.get(r.recurrenceParentId) ?? [];
    arr.push(r.recurrenceStart);
    map.set(r.recurrenceParentId, arr);
  }
  return map;
}

export async function findEvents(scope: ScheduleScope, query: string) {
  return prisma.event.findMany({
    where: { ...(await scopeWhere(scope)), title: { contains: query } },
    orderBy: { startsAt: 'asc' },
    take: 10,
  });
}

export async function cancelEvent(circleId: string, eventId: string) {
  const ev = await prisma.event.findFirst({ where: { id: eventId, circleId } });
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
  when: Date;
  recurrence?: string;
  assigneeName?: string | null;
}

/** Upcoming schedule for a scope: one-offs + next occurrence of recurring, merged. */
export async function getSchedule(
  scope: ScheduleScope,
  timezone: string,
  opts?: { from?: Date; to?: Date; limit?: number },
): Promise<ScheduleItem[]> {
  const from = opts?.from ?? new Date();
  const items: ScheduleItem[] = [];
  const base = await scopeWhere(scope);
  const include = { assignee: { select: { name: true } } } as const;

  const oneOff = await prisma.event.findMany({
    where: { ...base, rrule: null, startsAt: { gte: from, ...(opts?.to ? { lte: opts.to } : {}) } },
    orderBy: { startsAt: 'asc' },
    include,
  });
  for (const ev of oneOff)
    items.push({ event: ev, when: ev.startsAt, assigneeName: ev.assignee?.name ?? null });

  const recurring = await prisma.event.findMany({ where: { ...base, NOT: { rrule: null } }, include });
  const overrides = await overridesByParent(recurring.map((e) => e.id));
  for (const ev of recurring) {
    if (!ev.rrule) continue;
    const next = nextOccurrence(ev.rrule, ev.startsAt, timezone, from, overrides.get(ev.id));
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
  /** True for a private (individual) event — no group. */
  isPrivate: boolean;
}

const REMINDER_MS = REMINDER_BLOCK_MINUTES * 60_000;

function effectiveEnd(start: Date, end: Date | null, kind: string): Date | null {
  if (end) return end;
  if (kind === 'reminder') return new Date(start.getTime() + REMINDER_MS);
  return null;
}

/** Expand the schedule into occurrences within [from, to] for a calendar view. */
export async function expandCalendar(
  scope: ScheduleScope,
  timezone: string,
  from: Date,
  to: Date,
): Promise<Occurrence[]> {
  const out: Occurrence[] = [];
  const base = await scopeWhere(scope);
  const include = { assignee: { select: { name: true } } } as const;

  const oneOff = await prisma.event.findMany({
    where: { ...base, rrule: null, startsAt: { lte: to } },
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
      isPrivate: ev.groupId === null,
    });
  }

  const recurring = await prisma.event.findMany({ where: { ...base, NOT: { rrule: null } }, include });
  const overrides = await overridesByParent(recurring.map((e) => e.id));
  for (const ev of recurring) {
    if (!ev.rrule) continue;
    const durationMs = ev.endsAt
      ? ev.endsAt.getTime() - ev.startsAt.getTime()
      : ev.kind === 'reminder'
        ? REMINDER_MS
        : 0;
    for (const start of occurrencesBetween(ev.rrule, ev.startsAt, timezone, from, to, overrides.get(ev.id))) {
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
        isPrivate: ev.groupId === null,
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

/** Hard-block events (kind="event") in the scope overlapping [start, end]. */
export async function findConflicts(
  scope: ScheduleScope,
  timezone: string,
  start: Date,
  end: Date,
  excludeEventId?: string,
): Promise<Conflict[]> {
  const out: Conflict[] = [];
  const base = await scopeWhere(scope);
  const idFilter = excludeEventId ? { id: { not: excludeEventId } } : {};

  const oneOff = await prisma.event.findMany({
    where: { ...base, kind: 'event', rrule: null, ...idFilter },
  });
  for (const ev of oneOff) {
    const s = ev.startsAt;
    const e = ev.endsAt ?? new Date(s.getTime() + EVENT_DEFAULT_MS);
    if (s < end && e > start) out.push({ eventId: ev.id, title: ev.title, start: s, end: e });
  }

  const recurring = await prisma.event.findMany({
    where: { ...base, kind: 'event', rrule: { not: null }, ...idFilter },
  });
  const overrides = await overridesByParent(recurring.map((e) => e.id));
  for (const ev of recurring) {
    if (!ev.rrule) continue;
    const durationMs = ev.endsAt ? ev.endsAt.getTime() - ev.startsAt.getTime() : EVENT_DEFAULT_MS;
    const windowStart = new Date(start.getTime() - durationMs);
    for (const occ of occurrencesBetween(ev.rrule, ev.startsAt, timezone, windowStart, end, overrides.get(ev.id))) {
      const e = new Date(occ.getTime() + durationMs);
      if (occ < end && e > start) out.push({ eventId: ev.id, title: ev.title, start: occ, end: e });
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}
