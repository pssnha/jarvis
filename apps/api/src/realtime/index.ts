import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  appendMessages,
  getOrCreateConversation,
  loadHistory,
  runAgent,
} from '@jarvis/agent';
import { prisma } from '@jarvis/db';
import { env } from '../config/env';
import { createRedis } from '../plugins/redis';

/** Attach the Socket.IO realtime gateway (web chat + live updates) to the HTTP server. */
export function attachRealtime(httpServer: HttpServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: { origin: env.PUBLIC_WEB_ORIGIN },
  });

  // Multi-instance fan-out via Redis (also used by BullMQ).
  const pubClient = createRedis();
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.on('connection', (socket) => {
    socket.on('chat:message', async (data: { userId?: string; text?: string }) => {
      try {
        const text = (data?.text ?? '').trim();
        if (!text) return;

        // Demo identity: use the provided userId or fall back to the socket id.
        // Replace with real authentication.
        const userId = data.userId ?? socket.id;
        const user = await prisma.user.upsert({
          where: { id: userId },
          update: {},
          create: { id: userId },
        });

        const convo = await getOrCreateConversation(user.id, 'web');
        const history = await loadHistory(convo.id);
        const { reply } = await runAgent({ ctx: { userId: user.id }, history, userText: text });
        await appendMessages(convo.id, text, reply);

        socket.emit('chat:reply', { text: reply });
      } catch (err) {
        socket.emit('chat:error', { message: (err as Error).message });
      }
    });
  });

  return io;
}
