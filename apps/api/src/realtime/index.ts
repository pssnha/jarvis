import type { FastifyInstance } from 'fastify';
import { Server as IOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { appendMessages, getOrCreateConversation, loadHistory, runAgent } from '@jarvis/agent';
import { prisma } from '@jarvis/db';
import { env } from '../config/env';
import { createRedis } from '../plugins/redis';
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
      if (!userId) return next(new Error('unauthorized'));
      const user = await prisma.authUser.findUnique({ where: { id: userId } });
      if (!user) return next(new Error('unauthorized'));
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.on(
      'chat:message',
      async (data: { text?: string; authorName?: string; groupId?: string }) => {
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

          const { reply } = await runAgent({
            ctx: { groupId: group.id, timezone: group.timezone, source: 'web' },
            history,
            userText: text,
            authorName,
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
