import type { FastifyInstance } from 'fastify';
import { pino } from 'pino';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadApiEnv } from '../../src/config/env.js';
import { createContainer, type AppContainer } from '../../src/container.js';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env.js';

const env = loadApiEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  PUBLIC_BASE_URL: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'integration-test-access-secret-0123456789',
  HASH_SECRET: 'integration-test-hash-secret-0123456789abc',
  CONSENT_VERSION: 'test-v1',
  OTP_BYPASS: 'false',
});

let app: FastifyInstance;
let container: AppContainer;
let db: pg.Client;
const devOtps: string[] = [];

beforeAll(async () => {
  // Capture the OTP the console SMS provider "sends".
  const logger = pino(
    { level: 'info' },
    { write: (line: string) => { const code = JSON.parse(line).devOtp; if (code) devOtps.push(code); } },
  );
  container = createContainer(env, logger);
  app = await buildApp({ container, corsOrigins: [], logger });
  db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
});

afterAll(async () => {
  await app.close();
  await container.close();
  await db.end();
});

beforeEach(async () => {
  await db.query('TRUNCATE accounts, otp_challenges RESTART IDENTITY CASCADE');
  await container.redis?.flushdb();
  devOtps.length = 0;
});

const post = (url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers });

describe('auth against Postgres + Redis', () => {
  it('signs up, stores consent, hashes secrets, rotates refresh tokens', async () => {
    expect((await post('/v1/auth/otp/send', { phone: '+91 98765 43210' })).statusCode).toBe(204);
    expect(devOtps).toHaveLength(1);

    const verify = await post('/v1/auth/otp/verify', {
      phone: '9876543210',
      code: devOtps[0],
      ageConfirmed: true,
      consentVersion: 'test-v1',
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().isNewAccount).toBe(true);

    const account = await db.query('SELECT phone, "ageConfirmedAt" FROM accounts');
    expect(account.rows).toEqual([expect.objectContaining({ phone: '+919876543210' })]);
    const consent = await db.query('SELECT version FROM consent_records');
    expect(consent.rows).toEqual([{ version: 'test-v1' }]);

    // No plaintext OTP or phone in the challenge table.
    const otp = await db.query('SELECT "targetHash", "codeHash", "consumedAt" FROM otp_challenges');
    expect(JSON.stringify(otp.rows)).not.toContain('9876543210');
    expect(JSON.stringify(otp.rows)).not.toContain(devOtps[0]);
    expect(otp.rows[0].consumedAt).not.toBeNull();

    const refresh = verify.cookies.find((c) => c.name === 'hg_rt')!.value;
    const tokens = await db.query('SELECT "tokenHash" FROM refresh_tokens');
    expect(tokens.rows[0].tokenHash).not.toBe(refresh);

    const rotated = await post('/v1/auth/refresh', undefined, { cookie: `hg_rt=${refresh}`, 'x-hellogram-client': 'web' });
    expect(rotated.statusCode).toBe(200);
    const reuse = await post('/v1/auth/refresh', undefined, { cookie: `hg_rt=${refresh}`, 'x-hellogram-client': 'web' });
    expect(reuse.statusCode).toBe(401);
    const session = await db.query('SELECT "revokeReason" FROM sessions');
    expect(session.rows).toEqual([{ revokeReason: 'reuse_detected' }]);
  });

  it('limits OTP sends per phone in Redis', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/v1/auth/otp/send', { phone: '9123456780' })).statusCode).toBe(204);
    const res = await post('/v1/auth/otp/send', { phone: '9123456780' });
    expect(res.statusCode).toBe(429);
  });
});
