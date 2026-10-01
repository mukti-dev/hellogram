import { Redis } from 'ioredis';

/**
 * Creates an ioredis client. `maxRetriesPerRequest: null` is required by BullMQ
 * and harmless elsewhere; commands queue while reconnecting instead of failing.
 */
export function createRedisClient(url: string, connectionName: string): Redis {
  return new Redis(url, {
    connectionName,
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
}

export type { Redis };
