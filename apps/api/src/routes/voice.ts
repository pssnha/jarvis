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
import { prisma, type AuthUser } from '@jarvis/db';
import { accessibleScheduleCircleIds } from '../lib/access';

/** The circle a voice request acts on: the one named (if accessible) else the
 *  user's first accessible circle. (Schedule access is members-only.) */
async function resolveCircle(user: AuthUser, requestedId?: string) {
  const ids = await accessibleScheduleCircleIds(user);
  if (ids.length === 0) return null;
  const id = requestedId && ids.includes(requestedId) ? requestedId : ids[0]!;
  return prisma.circle.findUnique({ where: { id } });
}

async function circleCount(user: AuthUser): Promise<number> {
  return (await accessibleScheduleCircleIds(user)).length;
}

/** Voice API (Bearer-authenticated) — the contract the Alexa Lambda calls. */
export async function registerVoice(api: FastifyInstance): Promise<void> {
  // What circle the linked user maps to (so the skill can name it / disambiguate).
  api.get('/voice/context', async (req, reply) => {
    const user = req.authUser!;
    const circle = await resolveCircle(user);
    if (!circle) return reply.code(404).send({ error: 'no_circle' });
    return {
      circleId: circle.id,
      circleName: circle.name,
      timezone: circle.timezone,
      multipleCircles: (await circleCount(user)) > 1,
    };
  });

  // One conversational turn: same pipeline as the web chat, circle-scoped.
  api.post('/voice/turn', async (req, reply) => {
    const user = req.authUser!;
    const body = (req.body ?? {}) as { text?: string; circleId?: string };
    const text = (body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'empty_text' });

    const circle = await resolveCircle(user, body.circleId);
    if (!circle) return reply.code(404).send({ error: 'no_circle' });

    const isAdmin = user.role === 'admin';
    const meMember = await prisma.member.findFirst({
      where: {
        circleId: circle.id,
        OR: [
          ...(user.email ? [{ email: user.email }] : []),
          ...(user.waHash ? [{ waHash: user.waHash }] : []),
        ],
      },
    });

    const scope: ScheduleScope = { circleId: circle.id, kind: 'circle' };
    const convo = await getOrCreateConversation(circle.id, 'alexa', {});
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
        source: 'alexa',
        createdById: meMember?.id,
        isAdmin,
        groupContext: false,
      },
      history,
      userText: text,
      authorName: user.name ?? undefined,
      trips,
      surface: 'general',
    });

    await appendMessages(convo.id, text, speech, user.name ?? undefined);
    return { speech, circleId: circle.id, circleName: circle.name };
  });
}
