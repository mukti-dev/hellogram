import type { EphemeralStore } from '@hellogram/domain';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';

/** JSON values under a random, unguessable id that expire on their own. */
export class RedisEphemeralStore<T> implements EphemeralStore<T> {
  constructor(
    private readonly redis: Redis,
    private readonly namespace: string,
  ) {}

  private key(id: string) {
    return `hg:${this.namespace}:${id}`;
  }

  async put(value: T, ttlSeconds: number): Promise<string> {
    const id = randomBytes(24).toString('base64url');
    await this.redis.set(this.key(id), JSON.stringify(value), 'EX', ttlSeconds);
    return id;
  }

  async get(id: string): Promise<T | null> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return null;
    const raw = await this.redis.get(this.key(id));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async delete(id: string): Promise<void> {
    if (/^[A-Za-z0-9_-]{16,64}$/.test(id)) await this.redis.del(this.key(id));
  }
}
