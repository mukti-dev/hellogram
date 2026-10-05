import type { VaultSubject, VaultTokenStore } from '@hellogram/domain';
import type { Redis } from 'ioredis';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const key = (accountId: string, sessionId: string, s: VaultSubject) => `hg:vault:${accountId}:${sessionId}:${s.kind}:${s.id}`;
const digest = (token: string) => createHash('sha256').update(token).digest();
const UUID = /^[0-9a-f-]{36}$/;

/**
 * Vault tokens open one locked chat or one hidden space on one device (session) for a fixed
 * time the user picked — they don't slide. Only a hash is stored.
 */
export class RedisVaultTokenStore implements VaultTokenStore {
  constructor(private readonly redis: Redis) {}

  async issue(accountId: string, sessionId: string, subject: VaultSubject, ttlSeconds: number): Promise<string> {
    const token = `${subject.kind}.${subject.id}.${randomBytes(24).toString('base64url')}`;
    await this.redis.set(key(accountId, sessionId, subject), digest(token).toString('hex'), 'EX', ttlSeconds);
    return token;
  }

  async verify(accountId: string, sessionId: string, token: string): Promise<VaultSubject | null> {
    const [kind, id] = token.split('.');
    if ((kind !== 'chat' && kind !== 'space') || !id || !UUID.test(id)) return null;
    const subject: VaultSubject = { kind, id };
    const stored = await this.redis.get(key(accountId, sessionId, subject));
    if (!stored) return null;
    const a = Buffer.from(stored, 'hex');
    const b = digest(token);
    return a.length === b.length && timingSafeEqual(a, b) ? subject : null;
  }

  async revokeAll(accountId: string, kind: VaultSubject['kind']): Promise<void> {
    const stream = this.redis.scanStream({ match: `hg:vault:${accountId}:*:${kind}:*`, count: 200 });
    for await (const keys of stream as AsyncIterable<string[]>) {
      if (keys.length) await this.redis.del(...keys);
    }
  }
}
