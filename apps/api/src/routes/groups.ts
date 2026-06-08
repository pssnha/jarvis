import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';
import {
  cancelEvent,
  createEvent,
  dateKeyInZone,
  expandCalendar,
  getEvent,
  parseRRule,
  timeLabel,
  toLocalInput,
  updateEvent,
  type UpdateEventInput,
} from '@jarvis/agent';
import type { EventDraft, Recurrence } from '@jarvis/shared';

interface EventBody {
  title?: string;
  start?: string;
  end?: string | null;
  allDay?: boolean;
  location?: string | null;
  category?: string | null;
  recurrence?: Recurrence | null;
  assigneeId?: string | null;
}

/** Schedule data routes — available to any authenticated user. */
export async function registerGroups(app: FastifyInstance): Promise<void> {
  // Groups the user can view/manage (for the Calendar & Chat pickers), with members.
  // The maintenance calendar is only visible to admins.
  app.get('/groups', async (req) => {
    const isAdmin = req.authUser?.role === 'admin';
    return prisma.group.findMany({
      where: isAdmin ? {} : { kind: { not: 'maintenance' } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        kind: true,
        timezone: true,
        icalToken: true,
        whatsappGroupId: true,
        members: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' } },
      },
    });
  });

  // Members of a group (for the event-form assignee picker).
  app.get('/groups/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    return prisma.member.findMany({
      where: { groupId: id },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  // Calendar view: occurrences within [from, to], recurring events expanded.
  app.get('/groups/:id/calendar', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { from, to, memberId } = req.query as { from?: string; to?: string; memberId?: string };
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });

    const fromD = from ? new Date(from) : new Date();
    const toD = to ? new Date(to) : new Date(Date.now() + 31 * 86_400_000);
    const occ = await expandCalendar(id, group.timezone, fromD, toD, memberId || undefined);

    return occ.map((o) => ({
      eventId: o.eventId,
      title: o.title,
      dateKey: dateKeyInZone(o.start, group.timezone),
      startLocal: toLocalInput(o.start, group.timezone, o.allDay),
      timeLabel: o.allDay ? 'all day' : timeLabel(o.start, group.timezone),
      allDay: o.allDay,
      recurring: o.recurring,
      category: o.category,
      location: o.location,
      assigneeName: o.assigneeName,
      maintainsName: o.maintainsName,
    }));
  });

  // Create an event.
  app.post('/groups/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as EventBody;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });
    if (!body.title || !body.start) {
      return reply.code(400).send({ error: 'title and start are required' });
    }
    const draft: EventDraft = {
      title: body.title,
      start: body.start,
      end: body.end || undefined,
      allDay: !!body.allDay,
      location: body.location || undefined,
      category: (body.category || undefined) as EventDraft['category'],
      recurrence: body.recurrence || undefined,
    };
    return createEvent({
      groupId: id,
      source: 'web',
      timezone: group.timezone,
      draft,
      assigneeId: body.assigneeId ?? null,
    });
  });

  // Get one event (with form-friendly local times + structured recurrence).
  app.get('/groups/:id/events/:eventId', async (req, reply) => {
    const { id, eventId } = req.params as { id: string; eventId: string };
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });
    const ev = await getEvent(id, eventId);
    if (!ev) return reply.code(404).send({ error: 'event not found' });
    return {
      ...ev,
      startLocal: toLocalInput(ev.startsAt, group.timezone, ev.allDay),
      endLocal: ev.endsAt ? toLocalInput(ev.endsAt, group.timezone, ev.allDay) : null,
      recurrence: ev.rrule ? parseRRule(ev.rrule, group.timezone) : null,
    };
  });

  // Update an event.
  app.patch('/groups/:id/events/:eventId', async (req, reply) => {
    const { id, eventId } = req.params as { id: string; eventId: string };
    const body = (req.body ?? {}) as EventBody;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });

    const patch: UpdateEventInput = {
      title: body.title,
      start: body.start,
      allDay: body.allDay,
      end: body.end === undefined ? undefined : body.end || null,
      location: body.location === undefined ? undefined : body.location || null,
      category: body.category === undefined ? undefined : body.category || null,
      recurrence: body.recurrence === undefined ? undefined : body.recurrence || null,
      assigneeId: body.assigneeId === undefined ? undefined : body.assigneeId || null,
    };
    const ev = await updateEvent(id, eventId, patch, group.timezone);
    if (!ev) return reply.code(404).send({ error: 'event not found' });
    return ev;
  });

  // Delete an event (or whole recurring series).
  app.delete('/groups/:id/events/:eventId', async (req, reply) => {
    const { id, eventId } = req.params as { id: string; eventId: string };
    const ev = await cancelEvent(id, eventId);
    if (!ev) return reply.code(404).send({ error: 'event not found' });
    return { ok: true };
  });
}
