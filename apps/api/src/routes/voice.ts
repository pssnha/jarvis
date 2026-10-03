import type { FastifyInstance } from 'fastify';
import {
  appendMessages,
  getOrCreateConversation,
  listVacations,
  loadHistory,
  runAgent,
  toLocalInput,
  type ScheduleScope,
} from '@jarvis/agent';
import { prisma } from '@jarvis/db';
import { accessibleCircles, resolveCircle, selfMember } from '../lib/access';
import { mintAppSessionCode } from '../auth/appSession';

/** Voice API (Bearer-authenticated) — the contract the Alexa Lambda and the iOS
 *  app (Siri intents + in-app voice) call. Every turn runs on the `voice` tool
 *  surface: shared-calendar scheduling, trips read-only, spoken-style replies. */
export async function registerVoice(api: FastifyInstance): Promise<void> {
  // What circle the linked user maps to (so the skill can name it / disambiguate).
  api.get('/voice/context', async (req, reply) => {
    const user = req.authUser!;
    const q = (req.query ?? {}) as { circleId?: string };
    const circle = await resolveCircle(user, q.circleId);
    if (!circle) return reply.code(404).send({ error: 'no_circle' });
    const circles = await accessibleCircles(user);
    const grants = await prisma.circleAdmin.count({ where: { authUserId: user.id } });
    return {
      circleId: circle.id,
      circleName: circle.name,
      timezone: circle.timezone,
      multipleCircles: circles.length > 1,
      circles,
      email: user.email,
      // Mirrors the web's nav gating so the app shows the same admin pages.
      siteAdmin: user.role === 'admin',
      circleAdmin: grants > 0,
    };
  });

  // One-time code the app's embedded web view redeems for the web session cookie
  // (GET /api/auth/app-session/:code). Valid for a minute, single use.
  api.post('/voice/session', async (req) => ({ code: mintAppSessionCode(req.authUser!.id) }));

  // One conversational turn: same pipeline as the web chat, circle-scoped.
  api.post('/voice/turn', async (req, reply) => {
    const user = req.authUser!;
    const body = (req.body ?? {}) as { text?: string; circleId?: string };
    const text = (body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'empty_text' });

    const circle = await resolveCircle(user, body.circleId);
    if (!circle) return reply.code(404).send({ error: 'no_circle' });

    const isAdmin = user.role === 'admin';
    const meMember = await selfMember(user, circle.id);

    const scope: ScheduleScope = { circleId: circle.id, kind: 'circle' };
    // One thread per speaker: a "yes" from one family member must never confirm
    // a cancel another member's Siri turn just asked about.
    const convo = await getOrCreateConversation(circle.id, 'voice', { memberId: meMember?.id });
    const history = await loadHistory(convo.id);
    const trips = (await listVacations(circle.id, { includePast: false })).map((v) => ({
      id: v.id,
      title: v.title,
      destinations: v.destinations,
      start: toLocalInput(v.startDate, v.timezone ?? circle.timezone, true),
      end: toLocalInput(v.endDate, v.timezone ?? circle.timezone, true),
    }));

    const { reply: speech } = await runAgent({
      ctx: {
        circleId: circle.id,
        scope,
        timezone: circle.timezone,
        source: 'voice',
        createdById: meMember?.id,
        isAdmin,
        groupContext: false,
      },
      history,
      userText: text,
      authorName: user.name ?? undefined,
      trips,
      surface: 'voice',
    });

    await appendMessages(convo.id, text, speech, user.name ?? undefined);
    return { speech, circleId: circle.id, circleName: circle.name };
  });
}
