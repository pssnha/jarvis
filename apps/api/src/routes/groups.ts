import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';

export async function registerGroups(app: FastifyInstance): Promise<void> {
  // Create a scheduling group. (WhatsApp group provisioning happens separately
  // via the Groups API once the business number is live.)
  app.post('/groups', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; timezone?: string };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });

    const group = await prisma.group.create({
      data: { name: body.name, timezone: body.timezone ?? 'UTC' },
    });

    return {
      id: group.id,
      name: group.name,
      timezone: group.timezone,
      icalUrl: `/api/calendar/${group.icalToken}.ics`,
    };
  });

  // Add a member to a group (so emails/WhatsApp from them route to this group).
  app.post('/groups/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { name?: string; waId?: string; email?: string };
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });

    const member = await prisma.member.create({
      data: {
        groupId: id,
        name: body.name,
        waId: body.waId,
        email: body.email?.toLowerCase(),
      },
    });
    return member;
  });

  // List a group's upcoming events.
  app.get('/groups/:id/events', async (req) => {
    const { id } = req.params as { id: string };
    return prisma.event.findMany({
      where: { groupId: id },
      orderBy: { startsAt: 'asc' },
    });
  });
}
