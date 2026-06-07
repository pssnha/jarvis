import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';
import { provisionWhatsAppGroup, whatsappConfigured } from '@jarvis/agent';

/** Admin-only routes (site users, groups, members, WhatsApp onboarding). */
export async function registerAdmin(app: FastifyInstance): Promise<void> {
  // ----- Site users (access control) -----
  app.get('/admin/users', async () =>
    prisma.authUser.findMany({ orderBy: { createdAt: 'asc' } }),
  );

  app.post('/admin/users', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; name?: string; role?: string };
    if (!body.email) return reply.code(400).send({ error: 'email is required' });
    const role = body.role === 'admin' ? 'admin' : 'member';
    try {
      return await prisma.authUser.create({
        data: { email: body.email.toLowerCase(), name: body.name, role },
      });
    } catch {
      return reply.code(409).send({ error: 'a user with that email already exists' });
    }
  });

  app.delete('/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await prisma.authUser.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'user not found' });
    if (user.role === 'admin') {
      const admins = await prisma.authUser.count({ where: { role: 'admin' } });
      if (admins <= 1) return reply.code(400).send({ error: 'cannot remove the last admin' });
    }
    await prisma.authUser.delete({ where: { id } });
    return { ok: true };
  });

  // ----- Groups -----
  app.get('/admin/groups', async () =>
    prisma.group.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { members: true, events: true } } },
    }),
  );

  app.post('/admin/groups', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; timezone?: string };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });
    const group = await prisma.group.create({
      data: { name: body.name, timezone: body.timezone || 'UTC' },
    });
    return { ...group, icalUrl: `/api/calendar/${group.icalToken}.ics` };
  });

  // ----- Group members (schedule participants for WhatsApp/email routing) -----
  app.get('/admin/groups/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    return prisma.member.findMany({ where: { groupId: id }, orderBy: { createdAt: 'asc' } });
  });

  app.post('/admin/groups/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { name?: string; waId?: string; email?: string };
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });
    return prisma.member.create({
      data: { groupId: id, name: body.name, waId: body.waId, email: body.email?.toLowerCase() },
    });
  });

  app.delete('/admin/groups/:id/members/:memberId', async (req, reply) => {
    const { id, memberId } = req.params as { id: string; memberId: string };
    const m = await prisma.member.findFirst({ where: { id: memberId, groupId: id } });
    if (!m) return reply.code(404).send({ error: 'member not found' });
    await prisma.member.delete({ where: { id: m.id } });
    return { ok: true };
  });

  // ----- WhatsApp onboarding -----
  // Manual: paste an existing group id + invite link. Auto: create via the Groups API.
  app.post('/admin/groups/:id/whatsapp', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      whatsappGroupId?: string;
      inviteLink?: string;
      create?: boolean;
    };
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });

    let whatsappGroupId = body.whatsappGroupId;
    let inviteLink = body.inviteLink;

    if (body.create) {
      if (!whatsappConfigured()) {
        return reply.code(400).send({ error: 'WhatsApp credentials are not configured' });
      }
      try {
        const created = await provisionWhatsAppGroup(group.name);
        whatsappGroupId = created.groupId;
        inviteLink = created.inviteLink ?? inviteLink;
      } catch (err) {
        return reply.code(502).send({ error: (err as Error).message });
      }
    }

    if (!whatsappGroupId) {
      return reply.code(400).send({ error: 'whatsappGroupId is required (or set create:true)' });
    }

    return prisma.group.update({
      where: { id },
      data: { whatsappGroupId, inviteLink: inviteLink ?? null },
    });
  });
}
