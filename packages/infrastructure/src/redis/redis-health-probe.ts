import type { HealthProbe, ProbeStatus } from '@hellogram/domain';
import type { Redis } from 'ioredis';

export class RedisHealthProbe implements HealthProbe {
  readonly name = 'redis';

  constructor(private readonly redis: Redis) {}

  async check(): Promise<ProbeStatus> {
    return (await this.redis.ping()) === 'PONG' ? 'ok' : 'down';
  }
}
