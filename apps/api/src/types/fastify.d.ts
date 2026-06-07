import 'fastify';
import type { AuthUser } from '@jarvis/db';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
    googleOAuth2?: any;
  }
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}
