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
  const details = {
    name: 'Mukti Prasad',
    phone: '+91 98765 43210',
    dateOfBirth: '1995-05-10',
    gender: 'male',
    password: 'Sunrise!42',
    termsAccepted: true,
    consentVersion: 'test-v1',
  };

  it('signs up, stores consent, hashes secrets, rotates refresh tokens', async () => {
    const start = await post('/v1/auth/signup', details);
    expect(start.statusCode).toBe(200);
    expect(devOtps).toHaveLength(1);
    // Nothing is created until the mobile is verified.
    expect((await db.query('SELECT 1 FROM accounts')).rowCount).toBe(0);

    const verify = await post('/v1/auth/signup/verify', { signupId: start.json().signupId, code: devOtps[0] });
    expect(verify.statusCode).toBe(200);

    const account = await db.query('SELECT phone, name, gender, "dateOfBirth"::text AS dob, "passwordHash" FROM accounts');
    expect(account.rows).toEqual([expect.objectContaining({ phone: '+919876543210', name: 'Mukti Prasad', gender: 'male', dob: '1995-05-10' })]);
    // argon2id, never the password itself.
    expect(account.rows[0].passwordHash).toMatch(/^\$argon2id\$/);
    expect(account.rows[0].passwordHash).not.toContain('Sunrise');
    const consent = await db.query('SELECT version FROM consent_records');
    expect(consent.rows).toEqual([{ version: 'test-v1' }]);

    // No plaintext OTP or phone in the challenge table.
    const otp = await db.query('SELECT "targetHash", "codeHash", "consumedAt" FROM otp_challenges');
    expect(JSON.stringify(otp.rows)).not.toContain('9876543210');
    expect(JSON.stringify(otp.rows)).not.toContain(devOtps[0]);
    expect(otp.rows[0].consumedAt).not.toBeNull();

    // The device is remembered by a hash of its cookie.
    const device = verify.cookies.find((c) => c.name === 'hg_dev')!.value;
    const trusted = await db.query('SELECT "deviceHash" FROM trusted_devices');
    expect(trusted.rows).toHaveLength(1);
    expect(trusted.rows[0].deviceHash).not.toBe(device);

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

  it('logs in with the password; a new device verifies the mobile once, then it is remembered', async () => {
    const start = await post('/v1/auth/signup', details);
    await post('/v1/auth/signup/verify', { signupId: start.json().signupId, code: devOtps.at(-1) });

    const fresh = await post('/v1/auth/login', { phone: '9876543210', password: 'Sunrise!42' });
    expect(fresh.json().status).toBe('verify_device');
    const verified = await post('/v1/auth/login/verify', { ticket: fresh.json().ticket, code: devOtps.at(-1) });
    expect(verified.statusCode).toBe(200);
    const device = verified.cookies.find((c) => c.name === 'hg_dev')!.value;

    const sends = devOtps.length;
    const again = await post('/v1/auth/login', { phone: '9876543210', password: 'Sunrise!42' }, { cookie: `hg_dev=${device}` });
    expect(again.json().status).toBe('ok');
    expect(devOtps).toHaveLength(sends);
  });

  it('forgot password: new password works, the old one and old devices stop working', async () => {
    const start = await post('/v1/auth/signup', details);
    const first = await post('/v1/auth/signup/verify', { signupId: start.json().signupId, code: devOtps.at(-1) });
    const oldDevice = first.cookies.find((c) => c.name === 'hg_dev')!.value;

    expect((await post('/v1/auth/password/forgot', { phone: '9876543210' })).statusCode).toBe(204);
    const reset = await post('/v1/auth/password/reset', { phone: '9876543210', code: devOtps.at(-1), password: 'Moonlight#88' });
    expect(reset.statusCode).toBe(200);

    expect((await post('/v1/auth/login', { phone: '9876543210', password: 'Sunrise!42' })).json().error.code).toBe('INVALID_CREDENTIALS');
    const old = await post('/v1/auth/login', { phone: '9876543210', password: 'Moonlight#88' }, { cookie: `hg_dev=${oldDevice}` });
    expect(old.json().status).toBe('verify_device');
    expect((await db.query('SELECT "revokeReason" FROM sessions WHERE "revokedAt" IS NOT NULL')).rows).toEqual([{ revokeReason: 'password_reset' }]);
  });

  it('limits code sends per phone in Redis', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/v1/auth/password/forgot', { phone: '9123456780' })).statusCode).toBe(204);
    const res = await post('/v1/auth/password/forgot', { phone: '9123456780' });
    expect(res.statusCode).toBe(429);
  });

  describe('mobile app (no cookie jar)', () => {
    const native = { 'x-hellogram-client': 'native' };

    it('gets its tokens in the body, refreshes and logs out with headers, and remembers the device', async () => {
      const start = await post('/v1/auth/signup', details, native);
      const verify = await post('/v1/auth/signup/verify', { signupId: start.json().signupId, code: devOtps.at(-1) }, native);
      expect(verify.statusCode).toBe(200);
      const first = verify.json();
      expect(first).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String), deviceToken: expect.any(String) });
      expect(verify.cookies).toHaveLength(0);

      // Refresh with the header; the old token is single-use, as on the web.
      const rotated = await post('/v1/auth/refresh', undefined, { ...native, 'x-refresh-token': first.refreshToken });
      expect(rotated.statusCode).toBe(200);
      expect(rotated.json().refreshToken).toEqual(expect.any(String));
      expect(rotated.json().refreshToken).not.toBe(first.refreshToken);
      expect(rotated.cookies).toHaveLength(0);
      expect((await post('/v1/auth/refresh', undefined, { ...native, 'x-refresh-token': first.refreshToken })).statusCode).toBe(401);

      // The device token skips the code next time.
      const sends = devOtps.length;
      const again = await post('/v1/auth/login', { phone: '9876543210', password: 'Sunrise!42' }, { ...native, 'x-device-token': first.deviceToken });
      expect(again.json()).toMatchObject({ status: 'ok', refreshToken: expect.any(String), deviceToken: first.deviceToken });
      expect(devOtps).toHaveLength(sends);

      const out = await post('/v1/auth/logout', undefined, { ...native, 'x-refresh-token': again.json().refreshToken });
      expect(out.statusCode).toBe(204);
      expect((await post('/v1/auth/refresh', undefined, { ...native, 'x-refresh-token': again.json().refreshToken })).statusCode).toBe(401);
    });

    it('never hands tokens to a web page, even if a script claims to be the app', async () => {
      const start = await post('/v1/auth/signup', details);
      await post('/v1/auth/signup/verify', { signupId: start.json().signupId, code: devOtps.at(-1) });
      // Browsers always send Origin on these requests: the claim is ignored and cookies are used.
      const fromPage = { ...native, origin: 'https://app.hellogram.in' };
      const login = await post('/v1/auth/login', { phone: '9876543210', password: 'Sunrise!42' }, fromPage);
      const verified = await post('/v1/auth/login/verify', { ticket: login.json().ticket, code: devOtps.at(-1) }, fromPage);
      expect(verified.statusCode).toBe(200);
      expect(verified.json().refreshToken).toBeUndefined();
      expect(verified.json().deviceToken).toBeUndefined();
      expect(verified.cookies.map((c) => c.name).sort()).toEqual(['hg_dev', 'hg_rt']);
      // …and a refresh header from a page is not accepted either.
      const refresh = verified.cookies.find((c) => c.name === 'hg_rt')!.value;
      expect((await post('/v1/auth/refresh', undefined, { ...fromPage, 'x-refresh-token': refresh })).statusCode).toBe(401);
    });
  });
});
