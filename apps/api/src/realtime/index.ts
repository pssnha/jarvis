import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  appendMessages,
  getDemoGroup,
  getOrCreateConversation,
  loadHistory,
  runAgent,
} from '@jarvis/agent';
import { env } from '../config/env';
import { createRedis } from '../plugins/redis';

/** Attach the Socket.IO realtime gateway (web chat) to the HTTP server. */
export function attachRealtime(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: { origin: env.PUBLIC_WEB_ORIGIN },
  });

  // Multi-instance fan-out via Redis (also used by BullMQ).
  const pubClient = createRedis();
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.on('connection', (socket) => {
    socket.on(
      'chat:message',
      async (data: { text?: string; authorName?: string }) => {
        try {
          const text = (data?.text ?? '').trim();
          if (!text) return;

          // The web playground operates on a shared demo group.
          const group = await getDemoGroup(env.WEB_DEMO_TIMEZONE);
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
