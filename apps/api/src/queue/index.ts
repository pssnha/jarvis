import { Queue } from 'bullmq';
import { createRedis } from '../plugins/redis';

export const QUEUE_NAME = 'jarvis-jobs';

/** Producer-side queue handle (the worker app consumes from the same queue). */
export const jobsQueue = new Queue(QUEUE_NAME, { connection: createRedis() });

/** Example helper for enqueuing a job from a route. */
export async function enqueueExampleJob(payload: { message: string }) {
  return jobsQueue.add('example', payload);
}
