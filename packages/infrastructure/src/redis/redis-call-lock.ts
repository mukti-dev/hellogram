import type { CallLock } from '@hellogram/domain';
import type { Redis } from 'ioredis';

const key = (accountId: string) => `hg:call:acct:${accountId}`;
const sessionKey = (sessionId: string) => `hg:call:sess:${sessionId}`;

export class RedisCallLock implements CallLock {
  constructor(private readonly redis: Redis) {}

  async acquire(accountId: string, callId: string, ttlSeconds: number): Promise<boolean> {
    const existing = await this.redis.get(key(accountId));
    if (existing === callId) {
      await this.redis.expire(key(accountId), ttlSeconds);
      return true;
    }
    return (await this.redis.set(key(accountId), callId, 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  async release(accountId: string, callId: string): Promise<void> {
    // Only release our own lock.
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key(accountId),
      callId,
    );
  }

  holder(accountId: string): Promise<string | null> {
    return this.redis.get(key(accountId));
  }

  async bindSession(sessionId: string, callId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(sessionKey(sessionId), callId, 'EX', ttlSeconds);
  }

  sessionCall(sessionId: string): Promise<string | null> {
    return this.redis.get(sessionKey(sessionId));
  }
}
