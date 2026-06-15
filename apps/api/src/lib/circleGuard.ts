import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@jarvis/db';
import { canAccessSchedule, canManageCircle } from './access';

/**
 * USER-scope fail-safe: any `:cid` route is 403'd unless the caller may access
 * that circle's SCHEDULE DATA (member / per-circle admin / active break-glass
 * grant — never the site role alone). Registered after requireAuth so a new
 * `:cid` schedule route can't ship unscoped by accident.
 */
export async function requireScheduleParam(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cid = (req.params as { cid?: string } | undefined)?.cid;
  if (cid && !(await canAccessSchedule(req.authUser, cid))) {
    reply.code(403).send({ error: 'forbidden' });
  }
}

/**
 * ADMIN-scope fail-safe: any `:cid` admin route is 403'd unless the caller may
 * MANAGE that circle (site admin or per-circle admin). This is management only —
 * it does NOT imply access to the circle's data; data routes additionally check
 * canAccessSchedule.
 */
export async function requireManageCircleParam(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cid = (req.params as { cid?: string } | undefined)?.cid;
  if (cid && !(await canManageCircle(req.authUser, cid))) {
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
