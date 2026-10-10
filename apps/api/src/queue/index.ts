import { Queue } from 'bullmq';
import { createRedis } from '../plugins/redis';

export const QUEUE_NAME = 'jarvis-jobs';

/** Job announcing a newly created event to its group's linked channels. Must
 *  match the consumer in apps/worker/src/jobs. */
export const EVENT_CREATED_JOB = 'event-created';
export interface EventCreatedJob {
  eventId: string;
  /** Who added it, for the announcement ("added by Prakash via Muse"). */
  addedBy: string | null;
  via: string;
}

// Lazy so importing the app (e.g. in tests) doesn't open a Redis connection.
let queue: Queue | null = null;
function jobsQueue(): Queue {
  queue ??= new Queue(QUEUE_NAME, { connection: createRedis() });
  return queue;
}

export async function enqueueEventCreated(data: EventCreatedJob): Promise<void> {
  await jobsQueue().add(EVENT_CREATED_JOB, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}
