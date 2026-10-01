import type { UnlockTokenStore } from '@hellogram/domain';
import type { Redis } from 'ioredis';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const key = (sessionId: string, personaId: string) => `hg:unlock:${sessionId}:${personaId}`;
const digest = (token: string) => createHash('sha256').update(token).digest();

/**
 * Unlock tokens are scoped to (session/device, persona) and slide: every valid
 * use extends them by the TTL (5 minutes). Only a hash is stored.
 */
export class RedisUnlockTokenStore implements UnlockTokenStore {
  constructor(private readonly redis: Redis) {}

  async issue(sessionId: string, personaId: string, ttlSeconds: number): Promise<string> {
    const token = `${personaId}.${randomBytes(24).toString('base64url')}`;
    await this.redis.set(key(sessionId, personaId), digest(token).toString('hex'), 'EX', ttlSeconds);
    return token;
  }

  async verify(sessionId: string, token: string, ttlSeconds: number): Promise<string | null> {
    const [personaId] = token.split('.');
    if (!personaId || !/^[0-9a-f-]{36}$/.test(personaId)) return null;
    const stored = await this.redis.get(key(sessionId, personaId));
    if (!stored) return null;
    const a = Buffer.from(stored, 'hex');
    const b = digest(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    await this.redis.expire(key(sessionId, personaId), ttlSeconds);
    return personaId;
  }

  async revokeAll(personaId: string): Promise<void> {
    const stream = this.redis.scanStream({ match: `hg:unlock:*:${personaId}`, count: 200 });
    for await (const keys of stream as AsyncIterable<string[]>) {
      if (keys.length) await this.redis.del(...keys);
    }
  }
}
