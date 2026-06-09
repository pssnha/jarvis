import type { FastifyInstance } from 'fastify';
import ical from 'node-ical';
import { prisma } from '@jarvis/db';
import {
  createRawEvent,
  decryptValue,
  encryptPhone,
  encryptValue,
  ensureMaintenanceGroup,
  isMaintenanceText,
  maskPhone,
  openclawJobsToEvents,
  setUserWhatsApp,
  type ImportedEvent,
} from '@jarvis/agent';
import { createRedis } from '../plugins/redis';

const redis = createRedis();

/** Parse an iCalendar document into importable events. */
function parseIcs(text: string): { events: ImportedEvent[]; errors: string[] } {
  const events: ImportedEvent[] = [];
  const errors: string[] = [];
  let parsed: Record<string, unknown>;
  try {
    parsed = ical.sync.parseICS(text) as Record<string, unknown>;
  } catch (err) {
    return { events, errors: [`Invalid ICS: ${(err as Error).message}`] };
  }
  for (const key of Object.keys(parsed)) {
    const c = parsed[key] as any;
    if (!c || c.type !== 'VEVENT' || !c.start) continue;
    let rrule: string | null = null;
    if (c.rrule) {
      const s = String(c.rrule.toString());
      const line = s.split('\n').find((l: string) => l.startsWith('RRULE:'));
      rrule = line ? line.slice('RRULE:'.length) : s.replace(/^RRULE:/, '');
    }
    events.push({
      title: c.summary ? String(c.summary) : 'Untitled',
      description: c.description ? String(c.description) : null,
      startsAt: c.start as Date,
      endsAt: (c.end as Date) ?? null,
      allDay: c.datetype === 'date',
      location: c.location ? String(c.location) : null,
      rrule,
      sourceRef: c.uid ? String(c.uid) : null,
    });
  }
  return { events, errors };
}

/** Admin-only routes (site users, groups, members, WhatsApp linking). */
export async function registerAdmin(app: FastifyInstance): Promise<void> {
  // ----- Site users (access control) -----
  app.get('/admin/users', async () => {
    const users = await prisma.authUser.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt,
      waId: u.waEnc ? maskPhone(decryptValue(u.waEnc)) : null,
    }));
  });

  // Set/clear an admin's WhatsApp number (stored encrypted) so their 1:1 chat is recognized.
  app.post('/admin/users/:id/whatsapp', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { number?: string };
    const u = await prisma.authUser.findUnique({ where: { id } });
    if (!u) return reply.code(404).send({ error: 'user not found' });
    await setUserWhatsApp(id, body.number?.trim() || null);
    return { ok: true };
  });

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
    const members = await prisma.member.findMany({
      where: { groupId: id },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      waId: m.waEnc ? maskPhone(decryptValue(m.waEnc)) : null,
    }));
  });

  app.post('/admin/groups/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { name?: string; waId?: string; email?: string };
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });

    const data: { groupId: string; name?: string; email?: string; waEnc?: string; waHash?: string } = {
      groupId: id,
      name: body.name,
      email: body.email?.toLowerCase(),
    };
    if (body.waId) {
      const { enc, hash } = encryptPhone(body.waId);
      data.waEnc = enc;
      data.waHash = hash;
    }
    const m = await prisma.member.create({ data });
    return { id: m.id, name: m.name, email: m.email, waId: body.waId ? maskPhone(body.waId) : null };
  });

  app.delete('/admin/groups/:id/members/:memberId', async (req, reply) => {
    const { id, memberId } = req.params as { id: string; memberId: string };
    const m = await prisma.member.findFirst({ where: { id: memberId, groupId: id } });
    if (!m) return reply.code(404).send({ error: 'member not found' });
    await prisma.member.delete({ where: { id: m.id } });
    return { ok: true };
  });

  // ----- Per-group email polling config (IMAP) -----
  // The credential (app-password) is stored encrypted and never returned.
  app.get('/admin/groups/:id/email', async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.group.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: 'group not found' });
    return {
      address: g.emailAddress,
      host: g.emailHost,
      port: g.emailPort,
      enabled: g.emailEnabled,
      hasCredential: Boolean(g.emailEncCred),
      firstScanDone: g.emailFirstScanDone,
      lastPolledAt: g.emailLastPolledAt,
    };
  });

  app.post('/admin/groups/:id/email', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as {
      address?: string;
      credential?: string;
      host?: string;
      port?: number;
      enabled?: boolean;
    };
    const g = await prisma.group.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: 'group not found' });
    if (!body.address) return reply.code(400).send({ error: 'address is required' });

    await prisma.group.update({
      where: { id },
      data: {
        emailAddress: body.address.trim().toLowerCase(),
        emailHost: body.host?.trim() || 'imap.gmail.com',
        emailPort: body.port ?? 993,
        emailEnabled: body.enabled ?? true,
        // Only overwrite the credential when a new one is supplied.
        ...(body.credential ? { emailEncCred: encryptValue(body.credential) } : {}),
      },
    });
    return { ok: true };
  });

  app.delete('/admin/groups/:id/email', async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = await prisma.group.findUnique({ where: { id } });
    if (!g) return reply.code(404).send({ error: 'group not found' });
    await prisma.group.update({
      where: { id },
      data: {
        emailAddress: null,
        emailEncCred: null,
        emailHost: null,
        emailPort: null,
        emailEnabled: false,
        emailFirstScanDone: false,
        emailLastUid: null,
        emailLastPolledAt: null,
      },
    });
    return { ok: true };
  });

  // ----- WhatsApp linked-device status (QR + connection + available groups) -----
  app.get('/admin/whatsapp/status', async () => {
    const [status, qr, groups, self] = await Promise.all([
      redis.get('wa:status'),
      redis.get('wa:qr'),
      redis.get('wa:groups'),
      redis.get('wa:self'),
    ]);
    return {
      status: status ?? 'offline',
      qr: qr ?? null,
      self: self ?? null,
      groups: groups ? (JSON.parse(groups) as { id: string; subject: string }[]) : [],
    };
  });

  // Import a schedule into a group: .ics calendar OR an openclaw schedules JSON export.
  app.post('/admin/groups/:id/import', async (req, reply) => {
    const { id } = req.params as { id: string };
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return reply.code(404).send({ error: 'group not found' });

    const file = await (req as any).file?.();
    if (!file) return reply.code(400).send({ error: 'no file uploaded' });
    const text = (await file.toBuffer()).toString('utf8');
    const filename = String(file.filename ?? '');

    let imported: ImportedEvent[] = [];
    let skipped = 0;
    const errors: string[] = [];

    if (filename.toLowerCase().endsWith('.ics') || text.trimStart().startsWith('BEGIN:VCALENDAR')) {
      const r = parseIcs(text);
      imported = r.events;
      errors.push(...r.errors);
    } else {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return reply.code(400).send({ error: 'file is not valid JSON or ICS' });
      }
      if (data && typeof data === 'object' && 'jobs' in (data as object)) {
        const r = openclawJobsToEvents(data, group.timezone);
        imported = r.events;
        skipped = r.skipped;
        errors.push(...r.errors);
      } else {
        return reply.code(400).send({ error: 'unrecognized JSON (expected an openclaw export with "jobs")' });
      }
    }

    // Maintenance tasks go to the (internal) maintenance calendar, tagged with
    // the group they maintain; everything else goes to the chosen group.
    const maint = imported.some((e) => e.maintenance)
      ? await ensureMaintenanceGroup(group.timezone)
      : null;

    let created = 0;
    let maintenanceCount = 0;
    for (const ev of imported) {
      const { maintenance, ...rest } = ev;
      try {
        if (maintenance && maint) {
          await createRawEvent({ ...rest, groupId: maint.id, source: 'import', maintainsGroupId: id });
          maintenanceCount++;
        } else {
          await createRawEvent({ ...rest, groupId: id, source: 'import' });
        }
        created++;
      } catch (err) {
        errors.push(`Failed to save "${ev.title}": ${(err as Error).message}`);
      }
    }

    return { created, skipped, maintenance: maintenanceCount, errors };
  });

  // One-time: move existing maintenance-looking events out of user groups into
  // the maintenance calendar (so they stop showing in groups / WhatsApp).
  app.post('/admin/maintenance/migrate', async () => {
    const maint = await ensureMaintenanceGroup('America/Los_Angeles');
    const candidates = await prisma.event.findMany({
      where: { group: { kind: { not: 'maintenance' } } },
      select: { id: true, title: true, description: true, groupId: true },
    });
    let moved = 0;
    for (const ev of candidates) {
      if (!isMaintenanceText(ev.title, ev.description)) continue;
      await prisma.event.update({
        where: { id: ev.id },
        data: { groupId: maint.id, maintainsGroupId: ev.groupId },
      });
      moved++;
    }
    return { moved };
  });

}
