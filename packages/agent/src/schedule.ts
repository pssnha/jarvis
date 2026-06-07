import { prisma } from '@jarvis/db';
import type { Channel, EventDraft } from '@jarvis/shared';
import { localIsoToUtc } from './datetime';

export interface CreateEventInput {
  groupId: string;
  draft: EventDraft;
  source: Channel;
  timezone: string;
  sourceRef?: string;
  rawText?: string;
  createdById?: string;
}

export async function createEvent(input: CreateEventInput) {
  const { groupId, draft, source, timezone, sourceRef, rawText, createdById } = input;
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
      source,
      sourceRef,
      rawText,
      createdById,
    },
  });
}

export async function listUpcomingEvents(
  groupId: string,
  opts?: { from?: Date; to?: Date; limit?: number },
) {
  const from = opts?.from ?? new Date();
  return prisma.event.findMany({
    where: {
      groupId,
      startsAt: { gte: from, ...(opts?.to ? { lte: opts.to } : {}) },
    },
    orderBy: { startsAt: 'asc' },
    take: opts?.limit ?? 50,
  });
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
