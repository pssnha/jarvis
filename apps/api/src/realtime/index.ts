import type { FastifyInstance } from 'fastify';
import { Server as IOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
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
import { env } from '../config/env';
import { createRedis } from '../plugins/redis';
import { devBypass } from '../auth';
import { SESSION_COOKIE } from '../auth/constants';

/** Attach the Socket.IO realtime gateway (web chat) to the Fastify HTTP server. */
export function attachRealtime(app: FastifyInstance): IOServer {
  const io = new IOServer(app.server, {
    cors: { origin: env.PUBLIC_WEB_ORIGIN, credentials: true },
  });

  const pubClient = createRedis();
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  // Require a valid session cookie to connect.
  io.use(async (socket, next) => {
    try {
      const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
      const raw = cookies[SESSION_COOKIE];
      const unsigned = raw ? app.unsignCookie(raw) : null;
      const userId = unsigned?.valid ? unsigned.value : null;
      let user = userId ? await prisma.authUser.findUnique({ where: { id: userId } }) : null;
      // Local dev: no cookie → fall back to the seeded admin (never in production).
      if (!user && devBypass) {
        user = await prisma.authUser.findUnique({
          where: { email: env.ADMIN_EMAIL.toLowerCase() },
        });
      }
      if (!user) return next(new Error('unauthorized'));
      const d = socket.data as { userId?: string; role?: string; email?: string; waHash?: string };
      d.userId = user.id;
      d.role = user.role;
      d.email = user.email ?? undefined;
      d.waHash = user.waHash ?? undefined;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on(
      'chat:message',
      async (data: {
        text?: string;
        authorName?: string;
        circleId?: string;
        scope?: string; // group:<gid> | individual:<mid> | circle
        surface?: 'calendar' | 'vacations' | 'general';
      }) => {
        try {
          const text = (data?.text ?? '').trim();
          if (!text) return;
          if (!data.circleId) {
            socket.emit('chat:error', { message: 'No circle selected.' });
            return;
          }
          const d = socket.data as { userId?: string; role?: string; email?: string; waHash?: string };
          const circle = await prisma.circle.findUnique({ where: { id: data.circleId } });
          if (!circle) {
            socket.emit('chat:error', { message: 'Circle not found.' });
            return;
          }
          // Access check: site admins always; otherwise a member of the circle or
          // a per-circle admin of it.
          const isAdmin = d.role === 'admin';
          const meMember = await prisma.member.findFirst({
            where: {
              circleId: circle.id,
              OR: [...(d.email ? [{ email: d.email }] : []), ...(d.waHash ? [{ waHash: d.waHash }] : [])],
            },
          });
          const circleAdmin =
            !isAdmin && d.userId
              ? await prisma.circleAdmin.findUnique({
                  where: { circleId_authUserId: { circleId: circle.id, authUserId: d.userId } },
                })
              : null;
          if (!isAdmin && !meMember && !circleAdmin) {
            socket.emit('chat:error', { message: 'You do not have access to this circle.' });
            return;
          }

          // Parse the active scope.
          const raw = data.scope;
          const scope: ScheduleScope = raw?.startsWith('group:')
            ? { circleId: circle.id, kind: 'group', groupId: raw.slice(6) }
            : raw?.startsWith('individual:')
              ? { circleId: circle.id, kind: 'individual', memberId: raw.slice(11) }
              : { circleId: circle.id, kind: 'circle' };

          const convo = await getOrCreateConversation(circle.id, 'web', {
            groupId: scope.kind === 'group' ? scope.groupId : null,
            memberId: scope.kind === 'individual' ? scope.memberId : null,
          });
          const history = await loadHistory(convo.id);
          const authorName = data.authorName?.trim() || undefined;

          const surface = data.surface ?? 'general';
          const tripList =
            surface === 'calendar'
              ? []
              : (await listVacations(circle.id, { includePast: false })).map((v) => ({
                  id: v.id,
                  title: v.title,
                  destinations: v.destinations,
                  start: toLocalInput(v.startDate, v.timezone ?? circle.timezone, true),
                  end: toLocalInput(v.endDate, v.timezone ?? circle.timezone, true),
                }));

          const { reply } = await runAgent({
            ctx: {
              circleId: circle.id,
              scope,
              timezone: circle.timezone,
              source: 'web',
              createdById: meMember?.id,
              isAdmin,
              groupContext: false, // web user acts as themselves
            },
            history,
            userText: text,
            authorName,
            trips: tripList,
            surface,
          });

          await appendMessages(convo.id, text, reply, authorName);
          socket.emit('chat:reply', { text: reply });
        } catch (err) {
          socket.emit('chat:error', { message: (err as Error).message });
        }
      },
    );
  });

  return io;
}
