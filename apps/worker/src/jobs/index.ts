import { Worker } from 'bullmq';
import { createRedis } from '../lib/redis';
import { announceCreatedEvent, type EventCreatedJob } from '../announceEvent';

/** Must match the queue name used by the API producer (`apps/api/src/queue`). */
export const QUEUE_NAME = 'jarvis-jobs';
/** Must match EVENT_CREATED_JOB in the API producer. */
const EVENT_CREATED_JOB = 'event-created';

/** Start the BullMQ consumer for queue-driven jobs. */
export function startJobWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === EVENT_CREATED_JOB) {
        await announceCreatedEvent(job.data as EventCreatedJob);
        return { ok: true };
      }
      console.log(`[worker] unhandled job ${job.id} (${job.name})`, job.data);
      return { ok: true };
    },
    { connection: createRedis() },
  );

  worker.on('completed', (job) => console.log(`[worker] job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed:`, err));

  return worker;
}
