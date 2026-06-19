import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';
import { overridesByParent } from '@jarvis/agent';
import { buildICalendar } from '@jarvis/shared';

export async function registerCalendar(app: FastifyInstance): Promise<void> {
  // Read-only iCal subscription feed for a group (secret token in the URL).
  app.get('/calendar/:token.ics', async (req, reply) => {
    const { token } = req.params as { token: string };
    const group = await prisma.group.findUnique({ where: { icalToken: token } });
    if (!group) return reply.code(404).send('Not found');

    const events = await prisma.event.findMany({
      where: { groupId: group.id },
      orderBy: { startsAt: 'asc' },
    });
    // Exclude instants detached into overrides from each parent series, so
    // subscribers don't see a ghost at the original time.
    const overrides = await overridesByParent(events.filter((e) => e.rrule).map((e) => e.id));

    const ics = buildICalendar(
      group.name,
      events.map((e) => ({
        uid: e.id,
        title: e.title,
        description: e.description ?? undefined,
        start: e.startsAt,
        end: e.endsAt ?? undefined,
        allDay: e.allDay,
        location: e.location ?? undefined,
        rrule: e.rrule ?? undefined,
        exdates: e.rrule ? overrides.get(e.id) : undefined,
        transparent: e.kind !== 'event',
      })),
    );

    reply.header('Content-Type', 'text/calendar; charset=utf-8');
    return reply.send(ics);
  });
}
