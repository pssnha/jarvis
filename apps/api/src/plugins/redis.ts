import { Redis } from 'ioredis';
import { env } from '../config/env';

/**
 * Create an ioredis connection. `maxRetriesPerRequest: null` is required by
 * BullMQ and harmless for the Socket.IO adapter.
 */
export function createRedis(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
