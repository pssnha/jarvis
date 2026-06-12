import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@jarvis/db';
import { encryptPhone, encryptValue, maskPhone } from '@jarvis/agent';
import { env } from '../config/env';
import { createRedis } from '../plugins/redis';
import { verifyImap, imapHostFor } from '../email/verify';
import { sendMail } from '../email/mailer';

const redis = createRedis();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function token(): string {
  return crypto.randomBytes(24).toString('hex');
}

/** Which step the applicant should be on, given what's collected so far. */
function nextStep(s: { waNumber: string | null; emailAddress: string | null }): 'whatsapp' | 'email' | 'finish' {
  if (!s.waNumber) return 'whatsapp';
  if (!s.emailAddress) return 'email';
  return 'finish';
}

/** The applicant-facing view of a sign-up (no secrets). */
function publicView(s: {
  status: string;
  name: string;
  email: string;
  circleName: string | null;
  waNumber: string | null;
  emailAddress: string | null;
  circleId: string | null;
}) {
  return {
    status: s.status,
    name: s.name,
    email: s.email,
    circleName: s.circleName,
    waNumber: s.waNumber,
    emailAddress: s.emailAddress,
    circleId: s.circleId,
    step: nextStep(s),
  };
}

// ---------------------------------------------------------------------------
// Public sign-up routes (no auth). Mounted under /api.
// ---------------------------------------------------------------------------
export async function registerSignup(api: FastifyInstance): Promise<void> {
  // Step 1 — collect applicant details + record terms acceptance, then notify
  // the site admin so they can review and approve.
  api.post('/signup', async (req, reply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      email?: string;
      circleName?: string;
      phone?: string;
      acceptTerms?: boolean;
    };
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const phone = body.phone?.trim();
    if (!name) return reply.code(400).send({ error: 'Your name is required.' });
    if (!email || !EMAIL_RE.test(email)) return reply.code(400).send({ error: 'A valid email is required.' });
    if (!phone || phone.replace(/\D/g, '').length < 7) {
      return reply.code(400).send({ error: 'A valid WhatsApp phone number is required.' });
    }
    if (!body.acceptTerms) {
      return reply.code(400).send({ error: 'You must accept the terms to continue.' });
    }

    const { enc, hash } = encryptPhone(phone);
    const signup = await prisma.circleSignup.create({
      data: {
        name,
        email,
        circleName: body.circleName?.trim() || null,
        phoneEnc: enc,
        phoneHash: hash,
        phoneMask: maskPhone(phone) ?? '••••',
        termsVersion: env.TERMS_VERSION,
        termsAcceptedAt: new Date(),
        termsIp: req.ip,
        termsUserAgent: String(req.headers['user-agent'] ?? '').slice(0, 1000) || null,
        status: 'pending_review',
        reviewToken: token(),
        resumeToken: token(),
      },
    });

    const reviewUrl = `${env.AUTH_BASE_URL}/#/signups/${signup.id}`;
    await sendMail({
      to: env.ADMIN_NOTIFY_EMAIL,
      subject: `New Jarvis sign-up: ${name}`,
      html: `
        <h2>New circle sign-up</h2>
        <p>Someone has requested to set up a Jarvis circle.</p>
        <table cellpadding="6" style="border-collapse:collapse">
          <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
          <tr><td><strong>Email</strong></td><td>${escapeHtml(email)}</td></tr>
          <tr><td><strong>Circle</strong></td><td>${escapeHtml(body.circleName?.trim() || `${name}'s circle`)}</td></tr>
          <tr><td><strong>WhatsApp</strong></td><td>${escapeHtml(maskPhone(phone) ?? '')}</td></tr>
          <tr><td><strong>Terms</strong></td><td>Accepted v${env.TERMS_VERSION} at ${new Date().toISOString()}</td></tr>
        </table>
        <p><a href="${reviewUrl}">Review &amp; approve this sign-up →</a></p>
        <p style="color:#888;font-size:12px">Sign in as an admin to approve. Once approved, the applicant is emailed a link to finish connecting WhatsApp and email.</p>
      `,
    });

    return reply.send({ ok: true });
  });

  // The applicant returns here (via the approval email's resume link) to finish.
  api.get('/signup/resume/:resumeToken', async (req, reply) => {
    const { resumeToken } = req.params as { resumeToken: string };
    const s = await prisma.circleSignup.findUnique({ where: { resumeToken } });
    if (!s) return reply.code(404).send({ error: 'This sign-up link is invalid or has expired.' });
    return reply.send(publicView(s));
  });

  // Step 4 — the dedicated WhatsApp number Jarvis will use for this circle.
  api.post('/signup/resume/:resumeToken/whatsapp', async (req, reply) => {
    const { resumeToken } = req.params as { resumeToken: string };
    const body = (req.body ?? {}) as { waNumber?: string };
    const s = await prisma.circleSignup.findUnique({ where: { resumeToken } });
    if (!s) return reply.code(404).send({ error: 'This sign-up link is invalid or has expired.' });
    if (s.status !== 'approved') return reply.code(409).send({ error: 'This sign-up is not ready for setup yet.' });
    const num = body.waNumber?.trim();
    if (!num || num.replace(/\D/g, '').length < 7) {
      return reply.code(400).send({ error: 'Enter the WhatsApp number Jarvis will use (with country code).' });
    }
    const updated = await prisma.circleSignup.update({
      where: { id: s.id },
      data: { waNumber: num },
    });
    return reply.send(publicView(updated));
  });

  // Step 5 — the circle's dedicated mailbox (IMAP). Verified before saving.
  api.post('/signup/resume/:resumeToken/email', async (req, reply) => {
    const { resumeToken } = req.params as { resumeToken: string };
    const body = (req.body ?? {}) as { address?: string; credential?: string; host?: string; port?: number };
    const s = await prisma.circleSignup.findUnique({ where: { resumeToken } });
    if (!s) return reply.code(404).send({ error: 'This sign-up link is invalid or has expired.' });
    if (s.status !== 'approved') return reply.code(409).send({ error: 'This sign-up is not ready for setup yet.' });

    const address = body.address?.trim().toLowerCase();
    if (!address || !EMAIL_RE.test(address)) return reply.code(400).send({ error: 'A valid email address is required.' });
    // App-passwords are often pasted with spaces; IMAP needs them removed.
    const credential = body.credential?.replace(/\s+/g, '');
    if (!credential) return reply.code(400).send({ error: 'An email password (or app-password) is required.' });
    const host = body.host?.trim() || imapHostFor(address);
    const port = body.port ?? 993;

    // This mailbox can't already belong to another circle (it's the unique key).
    const taken = await prisma.circle.findUnique({ where: { emailAddress: address } });
    if (taken) return reply.code(409).send({ error: 'That mailbox is already connected to another circle.' });

    const check = await verifyImap({ user: address, password: credential, host, port });
    if (!check.ok) return reply.code(400).send({ error: check.error });

    const updated = await prisma.circleSignup.update({
      where: { id: s.id },
      data: { emailAddress: address, emailHost: host, emailPort: port, emailEncCred: encryptValue(credential) },
    });
    return reply.send(publicView(updated));
  });

  // Step 6 — provision the real circle and everything it needs.
  api.post('/signup/resume/:resumeToken/complete', async (req, reply) => {
    const { resumeToken } = req.params as { resumeToken: string };
    const s = await prisma.circleSignup.findUnique({ where: { resumeToken } });
    if (!s) return reply.code(404).send({ error: 'This sign-up link is invalid or has expired.' });
    if (s.status === 'completed' && s.circleId) return reply.send({ circleId: s.circleId, email: s.email });
    if (s.status !== 'approved') return reply.code(409).send({ error: 'This sign-up is not ready for setup yet.' });
    if (!s.waNumber) return reply.code(400).send({ error: 'Add the WhatsApp number first.' });
    if (!s.emailAddress || !s.emailEncCred) return reply.code(400).send({ error: 'Connect the mailbox first.' });

    const timezone = process.env.DEFAULT_TIMEZONE || 'UTC';
    const circleName = s.circleName || `${s.name}'s circle`;

    // Create the tenant + its first WhatsApp group + the applicant as a member,
    // and wire up the mailbox we verified earlier.
    const circle = await prisma.circle.create({
      data: {
        name: circleName,
        timezone,
        waSelf: s.waNumber,
        emailAddress: s.emailAddress,
        emailHost: s.emailHost,
        emailPort: s.emailPort,
        emailEncCred: s.emailEncCred,
        emailEnabled: true,
        groups: { create: { name: circleName } },
        members: {
          create: { name: s.name, email: s.email, waEnc: s.phoneEnc, waHash: s.phoneHash },
        },
      },
    });

    // Give the applicant a site login + admin rights over their new circle.
    const user = await prisma.authUser.upsert({
      where: { email: s.email },
      update: {},
      create: { email: s.email, name: s.name, role: 'member' },
    });
    await prisma.circleAdmin.upsert({
      where: { circleId_authUserId: { circleId: circle.id, authUserId: user.id } },
      update: {},
      create: { circleId: circle.id, authUserId: user.id },
    });

    await prisma.circleSignup.update({
      where: { id: s.id },
      data: { status: 'completed', circleId: circle.id, completedAt: new Date() },
    });

    // Boot the circle's WhatsApp session (so a QR is ready to link the number)
    // and scan the mailbox now rather than waiting for the scheduled poll.
    await redis.publish('wa:control', JSON.stringify({ action: 'start', circleId: circle.id }));
    await redis.publish('email:control', JSON.stringify({ action: 'poll', circleId: circle.id }));

    return reply.send({ circleId: circle.id, email: s.email });
  });
}

// ---------------------------------------------------------------------------
// Admin review routes. Mounted in the authenticated admin section.
// ---------------------------------------------------------------------------
function requireSite(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.authUser?.role === 'admin') return true;
  reply.code(403).send({ error: 'forbidden' });
  return false;
}

function adminView(s: {
  id: string;
  name: string;
  email: string;
  circleName: string | null;
  phoneMask: string;
  status: string;
  termsVersion: string;
  termsAcceptedAt: Date;
  waNumber: string | null;
  emailAddress: string | null;
  circleId: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}) {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    circleName: s.circleName,
    phoneMask: s.phoneMask,
    status: s.status,
    termsVersion: s.termsVersion,
    termsAcceptedAt: s.termsAcceptedAt,
    waNumber: s.waNumber,
    emailAddress: s.emailAddress,
    circleId: s.circleId,
    createdAt: s.createdAt,
    reviewedAt: s.reviewedAt,
  };
}

export async function registerAdminSignups(app: FastifyInstance): Promise<void> {
  app.get('/admin/signups', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const rows = await prisma.circleSignup.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(adminView);
  });

  app.get('/admin/signups/:id', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { id } = req.params as { id: string };
    const s = await prisma.circleSignup.findUnique({ where: { id } });
    if (!s) return reply.code(404).send({ error: 'sign-up not found' });
    return adminView(s);
  });

  app.post('/admin/signups/:id/approve', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { id } = req.params as { id: string };
    const s = await prisma.circleSignup.findUnique({ where: { id } });
    if (!s) return reply.code(404).send({ error: 'sign-up not found' });
    if (s.status === 'completed') return reply.code(409).send({ error: 'this sign-up is already completed' });

    const updated = await prisma.circleSignup.update({
      where: { id },
      data: { status: 'approved', reviewedAt: new Date(), reviewedBy: req.authUser?.email ?? null },
    });

    const resumeUrl = `${env.AUTH_BASE_URL}/#/welcome/${updated.resumeToken}`;
    await sendMail({
      to: updated.email,
      subject: 'Your Jarvis circle is approved — finish setup',
      html: `
        <h2>You're approved 🎉</h2>
        <p>Hi ${escapeHtml(updated.name)}, your Jarvis circle has been approved.</p>
        <p>Click below to finish setup — you'll connect a WhatsApp number and a mailbox, and your circle goes live.</p>
        <p><a href="${resumeUrl}">Finish setting up your circle →</a></p>
        <p style="color:#888;font-size:12px">If you didn't request this, you can ignore this email.</p>
      `,
    });

    return reply.send(adminView(updated));
  });

  app.post('/admin/signups/:id/reject', async (req, reply) => {
    if (!requireSite(req, reply)) return;
    const { id } = req.params as { id: string };
    const s = await prisma.circleSignup.findUnique({ where: { id } });
    if (!s) return reply.code(404).send({ error: 'sign-up not found' });
    const updated = await prisma.circleSignup.update({
      where: { id },
      data: { status: 'rejected', reviewedAt: new Date(), reviewedBy: req.authUser?.email ?? null },
    });
    return reply.send(adminView(updated));
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
