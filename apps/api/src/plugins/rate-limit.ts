import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';

let multiplier = 1;

/**
 * Per-route limits go through this so development/E2E runs can loosen them
 * (RATE_LIMIT_MULTIPLIER). Production always uses 1.
 */
export const limit = (max: number) => Math.max(1, Math.round(max * multiplier));
export const setRateLimitMultiplier = (value: number) => {
  multiplier = value;
};

export interface RateLimitOptions {
  /** Omit in tests to use the in-memory store. */
  redis?: Redis;
}

/**
 * Global safety net (per IP). Sensitive routes (OTP, requests, messages, PIN unlock,
 * public lookup) add stricter per-route limits via `config.rateLimit` — see §11.
 */
export const rateLimitPlugin = fp<RateLimitOptions>(async (app: FastifyInstance, options) => {
  await app.register(rateLimit, {
    global: true,
    max: limit(300),
    timeWindow: '1 minute',
    nameSpace: 'hg:rl:',
    ...(options.redis ? { redis: options.redis } : {}),
    skipOnError: true,
  });
});
