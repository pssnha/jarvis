import type { FastifyInstance } from 'fastify';
import { prisma } from '@jarvis/db';
import { PAT_PREFIX, randomToken, sha256 } from './oauth';

/** Personal access tokens for MCP clients (Meta Muse custom connector). The
 *  plaintext is returned once on creation; afterwards only metadata is listed. */
export async function registerTokens(api: FastifyInstance): Promise<void> {
  api.get('/tokens', async (req) =>
    prisma.personalAccessToken.findMany({
      where: { authUserId: req.authUser!.id },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  );

  api.post('/tokens', async (req, reply) => {
    const name = String(((req.body ?? {}) as { name?: unknown }).name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'name_required' });
    if (name.length > 100) return reply.code(400).send({ error: 'name_too_long' });
    const token = PAT_PREFIX + randomToken();
    const row = await prisma.personalAccessToken.create({
      data: { authUserId: req.authUser!.id, name, tokenHash: sha256(token) },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    return { ...row, token };
  });

  api.delete('/tokens/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { count } = await prisma.personalAccessToken.deleteMany({
      where: { id, authUserId: req.authUser!.id },
    });
    if (count === 0) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
}
