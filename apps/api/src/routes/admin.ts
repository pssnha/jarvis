import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import ical from 'node-ical';
import { prisma } from '@jarvis/db';
import {
  confirmProposalById,
  createRawEvent,
  decryptValue,
  encryptPhone,
  encryptValue,
  ensureGroupMember,
  maskPhone,
  openclawJobsToEvents,
  rejectProposalById,
  setUserWhatsApp,
  type ImportedEvent,
} from '@jarvis/agent';
import { createRedis } from '../plugins/redis';
import { verifyImap } from '../email/verify';

const redis = createRedis();

const MAINTENANCE_JOBS = ['email_poll', 'daily_brief', 'health_check'] as const;

/** The recurring maintenance jobs and how often they run (for the calendar). */
const MAINTENANCE_SCHEDULE = [
  { job: 'daily_brief', label: 'Daily brief', cadence: 'Daily · 7:00' },
  { job: 'email_poll', label: 'Email poll', cadence: 'Every 2 hours' },
  { job: 'health_check', label: 'Health check', cadence: 'Every 30 min' },
] as const;

/** Best-effort IMAP host for an email address (so the user never types it). */
function imapHostFor(address: string): string {
  const domain = address.split('@')[1]?.toLowerCase().trim() ?? '';
  if (/(^|\.)(gmail|googlemail)\.com$/.test(domain)) return 'imap.gmail.com';
  if (/(^|\.)(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return 'outlook.office365.com';
  if (/(^|\.)yahoo\.[a-z.]+$/.test(domain)) return 'imap.mail.yahoo.com';
  if (/(^|\.)(icloud|me|mac)\.com$/.test(domain)) return 'imap.mail.me.com';
  if (/(^|\.)aol\.com$/.test(domain)) return 'imap.aol.com';
  return domain ? `imap.${domain}` : 'imap.gmail.com';
}

/** Site admins manage everything; per-circle admins manage only their circle(s). */
function isSiteAdmin(req: FastifyRequest): boolean {
  return req.authUser?.role === 'admin';
}

/** Guard a site-admin-only route. Returns true if the request may proceed. */
function requireSite(req: FastifyRequest, reply: FastifyReply): boolean {
  if (isSiteAdmin(req)) return true;
  reply.code(403).send({ error: 'forbidden' });
  return false;
}

/** Guard a per-circle route (site admin or an admin of this circle). */
async function requireCircle(
  req: FastifyRequest,
  reply: FastifyReply,
  circleId: string,
): Promise<boolean> {
  if (isSiteAdmin(req)) return true;
  if (req.authUser?.id) {
    const g = await prisma.circleAdmin.findUnique({
      where: { circleId_authUserId: { circleId, authUserId: req.authUser.id } },
    });
    if (g) return true;
  }
  reply.code(403).send({ error: 'forbidden' });
  return false;
}

/** Circle ids the user can administer: site admin → null (all); else their grants. */
async function adminCircleScope(req: FastifyRequest): Promise<string[] | null> {
  if (isSiteAdmin(req)) return null;
  if (!req.authUser?.id) return [];
  const rows = await prisma.circleAdmin.findMany({
    where: { authUserId: req.authUser.id },
    select: { circleId: true },
  });
  return rows.map((r) => r.circleId);
}

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

/** Admin-only routes (site users, circles, members, groups, WhatsApp). */
export async function registerAdmin(app: FastifyInstance): Promise<void> {
  // ----- Site users (access control) — site admins only -----
  app.get('/admin/users', async (req, reply) => {
    if (!requireSite(req, reply)) return;
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

  app.post('/admin/users/:id/whatsapp', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { number?: string };
    const u = await prisma.authUser.findUnique({ where: { id } });
    if (!u) return reply.code(404).send({ error: 'user not found' });
    await setUserWhatsApp(id, body.number?.trim() || null);
    return { ok: true };
  });

  app.post('/admin/users', async (req, reply) => {
    if (!requireSite(req, reply)) return;
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
    if (!requireSite(req, reply)) return;
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

  // ----- Circles (site admins see all; circle admins see their own) -----
  app.get('/admin/circles', async (req) => {
    const scope = await adminCircleScope(req);
    const circles = await prisma.circle.findMany({
      where: scope === null ? {} : { id: { in: scope } },
      orderBy: { createdAt: 'asc' },
      include: {
        groups: {
          orderBy: { createdAt: 'asc' },
          include: { members: { select: { memberId: true } } },
        },
        members: { orderBy: { createdAt: 'asc' } },
        mutedJobs: { select: { job: true } },
        admins: { include: { user: { select: { email: true } } } },
        _count: { select: { events: true, vacations: true } },
      },
    });
    return circles.map((c) => {
      // A member is a "circle admin" when their email matches a granted AuthUser.
      const adminEmails = new Set(
        c.admins.map((a) => a.user.email?.toLowerCase()).filter(Boolean) as string[],
      );
      return {
      id: c.id,
      name: c.name,
      timezone: c.timezone,
      waSelf: c.waSelf,
      coverImageUrl: c.coverImageUrl,
      email: {
        address: c.emailAddress,
        host: c.emailHost,
        port: c.emailPort,
        enabled: c.emailEnabled,
        hasCredential: Boolean(c.emailEncCred),
        firstScanDone: c.emailFirstScanDone,
        lastPolledAt: c.emailLastPolledAt,
      },
      mutedJobs: c.mutedJobs.map((m) => m.job),
      counts: { events: c._count.events, vacations: c._count.vacations },
      groups: c.groups.map((g) => ({
        id: g.id,
        name: g.name,
        whatsappGroupId: g.whatsappGroupId,
        icalToken: g.icalToken,
        memberIds: g.members.map((m) => m.memberId),
      })),
      members: c.members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        waId: m.waEnc ? maskPhone(decryptValue(m.waEnc)) : null,
        role:
          m.email && adminEmails.has(m.email.toLowerCase())
            ? ('circle_admin' as const)
            : ('member' as const),
      })),
      };
    });
  });

  app.post('/admin/circles', async (req, reply) => {
    if (!requireSite(req, reply)) return; // only site admins create circles (tenants)
    const body = (req.body ?? {}) as { name?: string; timezone?: string };
    if (!body.name) return reply.code(400).send({ error: 'name is required' });
    const circle = await prisma.circle.create({
      data: { name: body.name, timezone: body.timezone || 'UTC' },
    });
    // Ask the worker to boot a WhatsApp session for the new circle (QR surfaces
    // in the per-circle Admin card).
    await redis.publish('wa:control', JSON.stringify({ action: 'start', circleId: circle.id }));
    return circle;
  });

  app.delete('/admin/circles/:cid', async (req, reply) => {
    if (!requireSite(req, reply)) return; // only site admins delete circles
    const { cid } = req.params as { cid: string };
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });
    await prisma.circle.delete({ where: { id: cid } });
    await redis.publish('wa:control', JSON.stringify({ action: 'stop', circleId: cid }));
    return { ok: true };
  });

  // ----- Per-circle admins (assign which AuthUsers manage a circle) — site only -----
  app.get('/admin/circles/:cid/admins', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { cid } = req.params as { cid: string };
    const rows = await prisma.circleAdmin.findMany({
      where: { circleId: cid },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ id: r.user.id, email: r.user.email, name: r.user.name }));
  });

  app.post('/admin/circles/:cid/admins', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { cid } = req.params as { cid: string };
    const body = (req.body ?? {}) as { email?: string };
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });
    if (!body.email) return reply.code(400).send({ error: 'email is required' });
    const user = await prisma.authUser.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user) {
      return reply.code(404).send({ error: 'no site member with that email — add them under Permissions first' });
    }
    await prisma.circleAdmin.upsert({
      where: { circleId_authUserId: { circleId: cid, authUserId: user.id } },
      update: {},
      create: { circleId: cid, authUserId: user.id },
    });
    return { id: user.id, email: user.email, name: user.name };
  });

  app.delete('/admin/circles/:cid/admins/:userId', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { cid, userId } = req.params as { cid: string; userId: string };
    await prisma.circleAdmin.deleteMany({ where: { circleId: cid, authUserId: userId } });
    return { ok: true };
  });

  // Upload a card background image for a circle (stored as a data URL).
  const MAX_COVER_BYTES = 3 * 1024 * 1024; // 3 MB
  app.post('/admin/circles/:cid/cover', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });

    const file = await (req as any).file?.();
    if (!file) return reply.code(400).send({ error: 'no file uploaded' });
    const mime = String(file.mimetype ?? '');
    if (!mime.startsWith('image/')) return reply.code(400).send({ error: 'file must be an image' });
    const buf = (await file.toBuffer()) as Buffer;
    if (buf.length > MAX_COVER_BYTES) {
      return reply.code(413).send({ error: 'image is too large (max 3 MB)' });
    }
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    await prisma.circle.update({ where: { id: cid }, data: { coverImageUrl: dataUrl } });
    return { coverImageUrl: dataUrl };
  });

  app.delete('/admin/circles/:cid/cover', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });
    await prisma.circle.update({ where: { id: cid }, data: { coverImageUrl: null } });
    return { ok: true };
  });

  // ----- Circle members -----
  app.post('/admin/circles/:cid/members', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const body = (req.body ?? {}) as { name?: string; waId?: string; email?: string };
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    if (!circle) return reply.code(404).send({ error: 'circle not found' });
    const data: { circleId: string; name?: string; email?: string; waEnc?: string; waHash?: string } = {
      circleId: cid,
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

  app.delete('/admin/circles/:cid/members/:memberId', async (req, reply) => {
    const { cid, memberId } = req.params as { cid: string; memberId: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const m = await prisma.member.findFirst({ where: { id: memberId, circleId: cid } });
    if (!m) return reply.code(404).send({ error: 'member not found' });
    await prisma.member.delete({ where: { id: m.id } });
    return { ok: true };
  });

  // Set a member's role within the circle (member ↔ circle admin) — site admins only.
  // Promoting links/creates the member's site login and grants CircleAdmin.
  app.put('/admin/circles/:cid/members/:memberId/role', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { cid, memberId } = req.params as { cid: string; memberId: string };
    const body = (req.body ?? {}) as { role?: 'member' | 'circle_admin' };
    const m = await prisma.member.findFirst({ where: { id: memberId, circleId: cid } });
    if (!m) return reply.code(404).send({ error: 'member not found' });

    if (body.role === 'circle_admin') {
      const email = m.email?.toLowerCase();
      if (!email) {
        return reply
          .code(400)
          .send({ error: 'add an email to this member before making them a circle admin' });
      }
      const user = await prisma.authUser.upsert({
        where: { email },
        update: {},
        create: { email, name: m.name, role: 'member' },
      });
      await prisma.circleAdmin.upsert({
        where: { circleId_authUserId: { circleId: cid, authUserId: user.id } },
        update: {},
        create: { circleId: cid, authUserId: user.id },
      });
    } else {
      // Demote: drop the per-circle grant if their login exists.
      if (m.email) {
        const user = await prisma.authUser.findUnique({ where: { email: m.email.toLowerCase() } });
        if (user) {
          await prisma.circleAdmin.deleteMany({ where: { circleId: cid, authUserId: user.id } });
        }
      }
    }
    return { ok: true };
  });

  // ----- Group membership (which members are in which WhatsApp group) -----
  app.post('/admin/circles/:cid/groups/:gid/members', async (req, reply) => {
    const { cid, gid } = req.params as { cid: string; gid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const body = (req.body ?? {}) as { memberId?: string };
    if (!body.memberId) return reply.code(400).send({ error: 'memberId is required' });
    const g = await prisma.group.findFirst({ where: { id: gid, circleId: cid } });
    const m = await prisma.member.findFirst({ where: { id: body.memberId, circleId: cid } });
    if (!g || !m) return reply.code(404).send({ error: 'group or member not found' });
    await ensureGroupMember(gid, body.memberId);
    return { ok: true };
  });

  app.delete('/admin/circles/:cid/groups/:gid/members/:mid', async (req, reply) => {
    const { cid, gid, mid } = req.params as { cid: string; gid: string; mid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const g = await prisma.group.findFirst({ where: { id: gid, circleId: cid } });
    if (!g) return reply.code(404).send({ error: 'group not found' });
    await prisma.groupMember.deleteMany({ where: { groupId: gid, memberId: mid } });
    return { ok: true };
  });

  // ----- Per-circle email polling config (IMAP); credential never returned -----
  app.post('/admin/circles/:cid/email', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const body = (req.body ?? {}) as {
      address?: string;
      credential?: string;
      host?: string;
      port?: number;
      enabled?: boolean;
    };
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });
    if (!body.address) return reply.code(400).send({ error: 'address is required' });
    const address = body.address.trim().toLowerCase();
    const host = body.host?.trim() || imapHostFor(address);
    const port = body.port ?? 993;
    // App-passwords are often shown/pasted with spaces ("abcd efgh ijkl mnop");
    // IMAP needs them removed.
    const credential = body.credential?.replace(/\s+/g, '');

    // When a credential is supplied, confirm the login actually works before
    // saving — never blindly store an unusable mailbox.
    if (credential) {
      const check = await verifyImap({ user: address, password: credential, host, port });
      if (!check.ok) return reply.code(400).send({ error: check.error });
    }

    await prisma.circle.update({
      where: { id: cid },
      data: {
        emailAddress: address,
        emailHost: host,
        emailPort: port,
        emailEnabled: body.enabled ?? true,
        ...(credential ? { emailEncCred: encryptValue(credential) } : {}),
      },
    });
    // A new/changed credential just verified — scan the mailbox now rather than
    // waiting for the next scheduled poll.
    if (credential) {
      await redis.publish('email:control', JSON.stringify({ action: 'poll', circleId: cid }));
    }
    return { ok: true };
  });

  app.delete('/admin/circles/:cid/email', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });
    await prisma.circle.update({
      where: { id: cid },
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

  // Trigger an immediate (ad-hoc) poll of the circle's mailbox.
  app.post('/admin/circles/:cid/email/poll', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });
    if (!c.emailAddress) return reply.code(400).send({ error: 'no mailbox configured' });
    await redis.publish('email:control', JSON.stringify({ action: 'poll', circleId: cid }));
    return { ok: true };
  });

  // Email activity: recent poll runs + the items they identified and their outcome.
  app.get('/admin/circles/:cid/email/activity', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const [polls, items] = await Promise.all([
      prisma.emailPollLog.findMany({
        where: { circleId: cid },
        orderBy: { ranAt: 'desc' },
        take: 50,
      }),
      prisma.emailProposal.findMany({
        where: { circleId: cid },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          kind: true,
          title: true,
          summary: true,
          fromEmail: true,
          subject: true,
          status: true,
          createdAt: true,
          decidedAt: true,
        },
      }),
    ]);
    return {
      polls: polls.map((p) => ({
        ranAt: p.ranAt,
        scanned: p.scanned,
        found: p.found,
        error: p.error,
      })),
      items,
    };
  });

  // Add or ignore a detected email item from the Activity log (an alternative to
  // replying on WhatsApp).
  app.post('/admin/circles/:cid/email/items/:id/confirm', async (req, reply) => {
    const { cid, id } = req.params as { cid: string; id: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const body = (req.body ?? {}) as { target?: string };
    return confirmProposalById(cid, id, body.target);
  });
  app.post('/admin/circles/:cid/email/items/:id/reject', async (req, reply) => {
    const { cid, id } = req.params as { cid: string; id: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const message = await rejectProposalById(cid, id);
    return { message };
  });

  // ----- Per-job, per-circle maintenance mute -----
  app.put('/admin/circles/:cid/jobs/:job', async (req, reply) => {
    const { cid, job } = req.params as { cid: string; job: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const body = (req.body ?? {}) as { muted?: boolean };
    if (!MAINTENANCE_JOBS.includes(job as (typeof MAINTENANCE_JOBS)[number])) {
      return reply.code(400).send({ error: 'unknown job' });
    }
    if (body.muted) {
      await prisma.circleMutedJob.upsert({
        where: { circleId_job: { circleId: cid, job } },
        update: {},
        create: { circleId: cid, job },
      });
    } else {
      await prisma.circleMutedJob.deleteMany({ where: { circleId: cid, job } });
    }
    return { ok: true };
  });

  // ----- Maintenance job-run calendar (site admins; cross-circle) -----
  // Per-day, per-job aggregates over [from, to). Email polls come from
  // EmailPollLog; daily_brief / health_check from MaintenanceRun.
  app.get('/admin/maintenance/calendar', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { from, to } = req.query as { from?: string; to?: string };
    const fromD = from ? new Date(from) : new Date(Date.now() - 14 * 86_400_000);
    const toD = to ? new Date(to) : new Date(Date.now() + 86_400_000);

    const toKey = (d: Date | string): string =>
      typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);

    const emailAgg = await prisma.$queryRaw<
      { d: Date | string; runs: bigint; found: bigint; errors: bigint }[]
    >`SELECT DATE(ranAt) AS d, COUNT(*) AS runs, COALESCE(SUM(found),0) AS found,
        SUM(error IS NOT NULL) AS errors
      FROM EmailPollLog WHERE ranAt >= ${fromD} AND ranAt < ${toD}
      GROUP BY DATE(ranAt)`;
    const maintAgg = await prisma.$queryRaw<
      { d: Date | string; job: string; runs: bigint; errors: bigint }[]
    >`SELECT DATE(ranAt) AS d, job, COUNT(*) AS runs, SUM(NOT ok) AS errors
      FROM MaintenanceRun WHERE ranAt >= ${fromD} AND ranAt < ${toD}
      GROUP BY DATE(ranAt), job`;

    const cells = [
      ...emailAgg.map((r) => ({
        date: toKey(r.d),
        job: 'email_poll' as const,
        runs: Number(r.runs),
        found: Number(r.found),
        errors: Number(r.errors),
      })),
      ...maintAgg.map((r) => ({
        date: toKey(r.d),
        job: r.job,
        runs: Number(r.runs),
        found: 0,
        errors: Number(r.errors),
      })),
    ];
    return { cells, schedules: MAINTENANCE_SCHEDULE };
  });

  // Drill-down: a single day's individual runs for one job (site admins).
  app.get('/admin/maintenance/runs', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { from, to, job } = req.query as { from?: string; to?: string; job?: string };
    if (!from || !to) return reply.code(400).send({ error: 'from and to are required' });
    const fromD = new Date(from);
    const toD = new Date(to);

    if (job === 'email_poll') {
      const rows = await prisma.emailPollLog.findMany({
        where: { ranAt: { gte: fromD, lt: toD } },
        orderBy: { ranAt: 'desc' },
        take: 200,
        include: { circle: { select: { name: true } } },
      });
      return {
        runs: rows.map((r) => ({
          job: 'email_poll',
          ranAt: r.ranAt,
          ok: !r.error,
          circle: r.circle?.name ?? null,
          summary: r.error
            ? `error: ${r.error}`
            : r.scanned === 0
              ? 'no new mail'
              : `scanned ${r.scanned} · found ${r.found}`,
        })),
      };
    }
    const rows = await prisma.maintenanceRun.findMany({
      where: { ranAt: { gte: fromD, lt: toD }, ...(job ? { job } : {}) },
      orderBy: { ranAt: 'desc' },
      take: 200,
      include: { circle: { select: { name: true } } },
    });
    return {
      runs: rows.map((r) => ({
        job: r.job,
        ranAt: r.ranAt,
        ok: r.ok,
        circle: r.circle?.name ?? null,
        summary: r.summary ?? '',
      })),
    };
  });

  // ----- Per-circle WhatsApp linked-device status (one session per circle) -----
  app.get('/admin/circles/:cid/whatsapp/status', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });
    const [status, qr, groups, self] = await Promise.all([
      redis.get(`wa:${cid}:status`),
      redis.get(`wa:${cid}:qr`),
      redis.get(`wa:${cid}:groups`),
      redis.get(`wa:${cid}:self`),
    ]);
    return {
      status: status ?? 'offline',
      qr: qr ?? null,
      self: self ?? null,
      groups: groups ? (JSON.parse(groups) as { id: string; subject: string }[]) : [],
    };
  });

  // Ask the worker to (re)start a circle's session — e.g. to surface a fresh QR.
  app.post('/admin/circles/:cid/whatsapp/start', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });
    await redis.publish('wa:control', JSON.stringify({ action: 'start', circleId: cid }));
    return { ok: true };
  });

  // Disconnect the circle's linked WhatsApp number (wipes auth → next start = fresh QR).
  app.post('/admin/circles/:cid/whatsapp/logout', async (req, reply) => {
    const { cid } = req.params as { cid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const c = await prisma.circle.findUnique({ where: { id: cid } });
    if (!c) return reply.code(404).send({ error: 'circle not found' });
    await redis.publish('wa:control', JSON.stringify({ action: 'logout', circleId: cid }));
    return { ok: true };
  });

  // Import a schedule into a circle's group: .ics calendar OR an openclaw JSON export.
  app.post('/admin/circles/:cid/groups/:gid/import', async (req, reply) => {
    const { cid, gid } = req.params as { cid: string; gid: string };
    if (!(await requireCircle(req, reply, cid))) return;
    const circle = await prisma.circle.findUnique({ where: { id: cid } });
    const group = await prisma.group.findFirst({ where: { id: gid, circleId: cid } });
    if (!circle || !group) return reply.code(404).send({ error: 'circle or group not found' });

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
        const r = openclawJobsToEvents(data, circle.timezone);
        imported = r.events;
        skipped = r.skipped;
        errors.push(...r.errors);
      } else {
        return reply.code(400).send({ error: 'unrecognized JSON (expected an openclaw export with "jobs")' });
      }
    }

    let created = 0;
    for (const ev of imported) {
      const { maintenance: _m, ...rest } = ev;
      try {
        await createRawEvent({ ...rest, circleId: cid, groupId: gid, source: 'import' });
        created++;
      } catch (err) {
        errors.push(`Failed to save "${ev.title}": ${(err as Error).message}`);
      }
    }
    return { created, skipped, errors };
  });
}
