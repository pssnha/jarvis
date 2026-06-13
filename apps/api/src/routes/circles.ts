import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '@jarvis/db';
import {
  cancelEvent,
  circleUsageStatus,
  createEvent,
  dateKeyInZone,
  expandCalendar,
  findConflicts,
  getEvent,
  localIsoToUtc,
  parseRRule,
  timeLabel,
  toLocalInput,
  updateEvent,
  type EventKind,
  type ScheduleScope,
  type UpdateEventInput,
} from '@jarvis/agent';
import type { EventDraft, Recurrence } from '@jarvis/shared';
import { accessibleCircleIds as accessibleCircleIdsForUser, canAccessCircle } from '../lib/access';

interface EventBody {
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
  /** Target: a group (shared) or a member (private). Omit → circle primary group. */
  groupId?: string | null;
  ownerMemberId?: string | null;
}

/** Circles the user may access (see lib/access). */
function accessibleCircleIds(req: FastifyRequest): Promise<string[] | 'all'> {
  return accessibleCircleIdsForUser(req.authUser);
}

function canAccess(req: FastifyRequest, circleId: string): Promise<boolean> {
  return canAccessCircle(req.authUser, circleId);
}

function parseScope(circleId: string, raw?: string): ScheduleScope {
  if (raw?.startsWith('group:')) return { circleId, kind: 'group', groupId: raw.slice(6) };
  if (raw?.startsWith('individual:')) return { circleId, kind: 'individual', memberId: raw.slice(11) };
  return { circleId, kind: 'circle' };
}

/** Circle-scoped schedule routes (requireAuth). */
export async function registerCircles(app: FastifyInstance): Promise<void> {
  // Circles the user can see (Calendar / Vacations / Chat pickers).
  app.get('/circles', async (req) => {
    const ids = await accessibleCircleIds(req);
    return prisma.circle.findMany({
      where: ids === 'all' ? {} : { id: { in: ids } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        timezone: true,
        groups: {
          select: { id: true, name: true, icalToken: true, whatsappGroupId: true },
          orderBy: { createdAt: 'asc' },
        },
        members: { select: { id: true, name: true }, orderBy: { createdAt: 'asc' } },
      },
    });
  });

  app.get('/circles/:cid/members', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await canAccess(req, cid))) return reply.code(403).send({ error: 'forbidden' });
    return prisma.member.findMany({
      where: { circleId: cid },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  // Current LLM spend vs caps for the circle (powers the chat usage footer).
  app.get('/circles/:cid/usage', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await canAccess(req, cid))) return reply.code(403).send({ error: 'forbidden' });
    const circle = await prisma.circle.findUnique({ where: { id: cid }, select: { timezone: true } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    return circleUsageStatus(cid, circle.timezone);
  });

  // Calendar occurrences within [from, to] for a scope (group / individual / circle).
  app.get('/circles/:cid/calendar', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    const { from, to, scope } = req.query as { from?: string; to?: string; scope?: string };
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    if (!(await canAccess(req, cid))) return reply.code(403).send({ error: 'forbidden' });

    const tz = circle.timezone;
    const fromD = from ? new Date(from) : new Date();
    const toD = to ? new Date(to) : new Date(Date.now() + 31 * 86_400_000);
    const occ = await expandCalendar(parseScope(cid, scope), tz, fromD, toD);
    return occ.map((o) => ({
      eventId: o.eventId,
      title: o.title,
      dateKey: dateKeyInZone(o.start, tz),
      startLocal: toLocalInput(o.start, tz, o.allDay),
      endLocal: o.end ? toLocalInput(o.end, tz, o.allDay) : null,
      timeLabel: o.allDay ? 'all day' : timeLabel(o.start, tz),
      allDay: o.allDay,
      recurring: o.recurring,
      kind: o.kind,
      category: o.category,
      color: o.color,
      location: o.location,
      assigneeName: o.assigneeName,
      isPrivate: o.isPrivate,
    }));
  });

  app.post('/circles/:cid/events', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    const body = (req.body ?? {}) as EventBody;
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    if (!(await canAccess(req, cid))) return reply.code(403).send({ error: 'forbidden' });
    if (!body.title || !body.start) return reply.code(400).send({ error: 'title and start are required' });

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
      circleId: cid,
      groupId: body.groupId ?? null,
      ownerMemberId: body.ownerMemberId ?? null,
      source: 'web',
      timezone: circle.timezone,
      draft,
      assigneeId: body.assigneeId ?? null,
      color: body.color ?? null,
      kind: body.kind ?? 'reminder',
      reminderLeadMinutes: body.reminderLeadMinutes ?? null,
    });
  });

  app.get('/circles/:cid/conflicts', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    const { start, end, exclude, scope } = req.query as {
      start?: string;
      end?: string;
      exclude?: string;
      scope?: string;
    };
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    if (!(await canAccess(req, cid))) return reply.code(403).send({ error: 'forbidden' });
    if (!start) return reply.code(400).send({ error: 'start is required' });

    const startUtc = localIsoToUtc(start, circle.timezone);
    const endUtc = end ? localIsoToUtc(end, circle.timezone) : new Date(startUtc.getTime() + 3_600_000);
    const conflicts = await findConflicts(
      parseScope(cid, scope),
      circle.timezone,
      startUtc,
      endUtc,
      exclude || undefined,
    );
    return conflicts.map((c) => ({
      eventId: c.eventId,
      title: c.title,
      timeLabel: `${timeLabel(c.start, circle.timezone)}–${timeLabel(c.end, circle.timezone)}`,
    }));
  });

  app.get('/circles/:cid/events/:eventId', async (req, reply) => {
    const { cid, eventId } = req.params as { cid: string; eventId: string };
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    if (!(await canAccess(req, cid))) return reply.code(403).send({ error: 'forbidden' });
    const ev = await getEvent(cid, eventId);
    if (!ev) return reply.code(404).send({ error: 'event not found' });
    return {
      ...ev,
      startLocal: toLocalInput(ev.startsAt, circle.timezone, ev.allDay),
      endLocal: ev.endsAt ? toLocalInput(ev.endsAt, circle.timezone, ev.allDay) : null,
      recurrence: ev.rrule ? parseRRule(ev.rrule, circle.timezone) : null,
    };
  });

  app.patch('/circles/:cid/events/:eventId', async (req, reply) => {
    const { cid, eventId } = req.params as { cid: string; eventId: string };
    const body = (req.body ?? {}) as EventBody;
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    if (!(await canAccess(req, cid))) return reply.code(403).send({ error: 'forbidden' });

    const patch: UpdateEventInput = {
      title: body.title,
      start: body.start,
      allDay: body.allDay,
      end: body.end === undefined ? undefined : body.end || null,
      location: body.location === undefined ? undefined : body.location || null,
      category: body.category === undefined ? undefined : body.category || null,
      recurrence: body.recurrence === undefined ? undefined : body.recurrence || null,
      assigneeId: body.assigneeId === undefined ? undefined : body.assigneeId || null,
      color: body.color === undefined ? undefined : body.color || null,
      kind: body.kind,
      reminderLeadMinutes:
        body.reminderLeadMinutes === undefined ? undefined : body.reminderLeadMinutes,
    };
    const ev = await updateEvent(cid, eventId, patch, circle.timezone);
    if (!ev) return reply.code(404).send({ error: 'event not found' });
    return ev;
  });

  app.delete('/circles/:cid/events/:eventId', async (req, reply) => {
    const { cid, eventId } = req.params as { cid: string; eventId: string };
    if (!(await canAccess(req, cid))) return reply.code(403).send({ error: 'forbidden' });
    const ev = await cancelEvent(cid, eventId);
    if (!ev) return reply.code(404).send({ error: 'event not found' });
    return { ok: true };
  });
}
