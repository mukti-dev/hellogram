import type { RateLimiter } from '@hellogram/domain';
import type { Redis } from 'ioredis';

/** Fixed-window counter: INCR + EXPIRE on first hit. */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'hg:lim:',
  ) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const fullKey = `${this.prefix}${key}`;
    const [[, count]] = (await this.redis.multi().incr(fullKey).expire(fullKey, windowSeconds, 'NX').exec()) as [
      [Error | null, number],
      [Error | null, number],
    ];
    return count <= limit;
  }
}
