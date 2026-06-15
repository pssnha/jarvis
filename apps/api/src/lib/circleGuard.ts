import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@jarvis/db';
import { canAccessCircle } from './access';

/**
 * Fail-safe circle scoping: any route with a `:cid` param is 403'd unless the
 * authenticated caller may access that circle. Registered as a preHandler after
 * requireAuth so a new `:cid` route can never ship unscoped by accident — the
 * per-route checks (canAccess / requireCircle) remain as defense in depth.
 */
export async function requireCircleParam(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cid = (req.params as { cid?: string } | undefined)?.cid;
  if (cid && !(await canAccessCircle(req.authUser, cid))) {
    reply.code(403).send({ error: 'forbidden' });
  }
}

/**
 * Member-facing guard: a soft-deleted (dormant) circle is treated as gone — any
 * `:cid` route 404s until it's restored. Registered ONLY on the user scope, so
 * admins can still manage/restore a deleted circle from the admin scope.
 */
export async function rejectDeletedCircleParam(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cid = (req.params as { cid?: string } | undefined)?.cid;
  if (!cid) return;
  const c = await prisma.circle.findUnique({ where: { id: cid }, select: { deletedAt: true } });
  if (c?.deletedAt) reply.code(404).send({ error: 'circle not found' });
}
