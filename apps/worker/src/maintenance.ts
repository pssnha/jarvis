import { prisma } from '@jarvis/db';
import { allCircleIds } from '@jarvis/agent';
import { createRedis } from './lib/redis';
import { isConnected } from './whatsapp/client';

const RETENTION_MS = 14 * 24 * 3_600_000; // keep 14 days of run history
const redis = createRedis();

/** Append a maintenance-run row and prune old history. */
export async function recordRun(
  job: string,
  opts: { circleId?: string | null; ok?: boolean; summary?: string } = {},
): Promise<void> {
  try {
    await prisma.maintenanceRun.create({
      data: {
        job,
        circleId: opts.circleId ?? null,
        ok: opts.ok ?? true,
        summary: opts.summary?.slice(0, 500) ?? null,
      },
    });
    await prisma.maintenanceRun.deleteMany({
      where: { ranAt: { lt: new Date(Date.now() - RETENTION_MS) } },
    });
  } catch (err) {
    console.error('[maint] failed to record run:', err);
  }
}

/** Health check: verify DB + Redis + WhatsApp sessions, then log the result. */
export async function runHealthCheck(): Promise<void> {
  let dbOk = true;
  let redisOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  try {
    await redis.ping();
  } catch {
    redisOk = false;
  }
  const ids = await allCircleIds().catch(() => [] as string[]);
  const waUp = ids.filter((id) => isConnected(id)).length;
  await recordRun('health_check', {
    ok: dbOk && redisOk,
    summary: `db ${dbOk ? 'ok' : 'down'} · redis ${redisOk ? 'ok' : 'down'} · whatsapp ${waUp}/${ids.length}`,
  });
}
