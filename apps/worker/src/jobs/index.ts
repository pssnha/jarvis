import { Worker } from 'bullmq';
import { createRedis } from '../lib/redis';

/** Must match the queue name used by the API producer (`apps/api/src/queue`). */
export const QUEUE_NAME = 'jarvis-jobs';

/** Start the BullMQ consumer for queue-driven jobs. */
export function startJobWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      // Handle queue-driven jobs here.
      console.log(`[worker] processing job ${job.id} (${job.name})`, job.data);
      return { ok: true };
    },
    { connection: createRedis() },
  );

  worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed:`, err));

  return worker;
}
