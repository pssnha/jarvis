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
      (socket.data as { role?: string }).role = user.role;
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
        groupId?: string;
        surface?: 'calendar' | 'vacations' | 'general';
      }) => {
        try {
          const text = (data?.text ?? '').trim();
          if (!text) return;
          if (!data.groupId) {
            socket.emit('chat:error', { message: 'No group selected.' });
            return;
          }
          const group = await prisma.group.findUnique({ where: { id: data.groupId } });
          if (!group) {
            socket.emit('chat:error', { message: 'Group not found.' });
            return;
          }

          const convo = await getOrCreateConversation(group.id, 'web');
          const history = await loadHistory(convo.id);
          const authorName = data.authorName?.trim() || undefined;

          const surface = data.surface ?? 'general';
          // Trip context is only relevant off the Calendar page.
          const tripList =
            surface === 'calendar'
              ? []
              : (await listVacations(group.id, { includePast: false })).map((v) => ({
                  id: v.id,
                  title: v.title,
                  destinations: v.destinations,
                  start: toLocalInput(v.startDate, v.timezone ?? group.timezone, true),
                  end: toLocalInput(v.endDate, v.timezone ?? group.timezone, true),
                }));

          const isAdmin = (socket.data as { role?: string }).role === 'admin';
          const { reply } = await runAgent({
            ctx: {
              groupId: group.id,
              timezone: group.timezone,
              source: 'web',
              isAdmin,
              maintenance: group.kind === 'maintenance',
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
