import { Redis } from 'ioredis';

/** ioredis connection for BullMQ (`maxRetriesPerRequest: null` is required). */
export function createRedis(): Redis {
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
}
