import { prisma } from '@jarvis/db';
import { createRedis } from './lib/redis';
import { recordRun } from './maintenance';

const redis = createRedis();
let purging = false;

/**
 * Hard-delete circles whose soft-delete grace period has expired. A circle is
 * "scheduled for deletion" when it has a `purgeAfter` timestamp (set by the API
 * on delete, cleared on reinstate); once that passes we wipe its WhatsApp
 * session/auth and cascade-delete the circle and all its data.
 */
export async function purgeExpiredCircles(): Promise<void> {
  if (purging) return;
  purging = true;
  try {
    const due = await prisma.circle.findMany({
      where: { purgeAfter: { not: null, lte: new Date() } },
      select: { id: true, name: true },
    });
    for (const c of due) {
      try {
        // Unlink the device + wipe the circle's WhatsApp auth before removing it.
        await redis.publish('wa:control', JSON.stringify({ action: 'logout', circleId: c.id }));
        // Cascade-deletes groups, members, events, vacations, conversations, …
        await prisma.circle.delete({ where: { id: c.id } });
        // circleId stays null: the circle no longer exists (FK is SetNull anyway).
        await recordRun('purge_circle', { ok: true, summary: `purged "${c.name}" (${c.id})` });
      } catch (err) {
        await recordRun('purge_circle', {
          ok: false,
          summary: `failed to purge "${c.name}": ${(err as Error).message}`,
        });
        console.error(`[purge] failed to delete circle ${c.id}:`, err);
      }
    }
  } finally {
    purging = false;
  }
}
