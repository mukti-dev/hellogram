import type { FastifyInstance, InjectOptions } from 'fastify';
import { pino } from 'pino';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadApiEnv, type ApiEnv } from '../../src/config/env.js';
import { createContainer, type AppContainer, type ContainerOverrides } from '../../src/container.js';
import { TEST_DATABASE_URL, TEST_REDIS_URL } from './env.js';

export interface Harness {
  app: FastifyInstance;
  container: AppContainer;
  db: pg.Client;
  env: ApiEnv;
  devOtps: string[];
  reset(): Promise<void>;
  close(): Promise<void>;
  /** Signs up a phone number (or, if it exists, logs in from a new device), with the bypass/dev code. */
  signUp(phone?: string): Promise<User>;
}

export interface User {
  token: string;
  refresh: string;
  headers: Record<string, string>;
  request<T = unknown>(opts: Omit<InjectOptions, 'headers'> & { headers?: Record<string, string> }): Promise<{
    status: number;
    body: T;
    headers: Record<string, unknown>;
  }>;
}

export const TEST_PASSWORD = 'Test-Password!42';
/** Everything sign-up needs besides the phone. */
export const TEST_SIGNUP = {
  name: 'Test User',
  dateOfBirth: '1995-05-10',
  gender: 'other',
  password: TEST_PASSWORD,
  termsAccepted: true,
  consentVersion: 'test-v1',
};

let phoneCounter = 0;
export const nextPhone = () => `9${String(100_000_000 + ((Date.now() + phoneCounter++) % 899_999_999)).padStart(9, '0')}`;

export async function createHarness(
  overrides: Record<string, string> = {},
  containerOverrides: ContainerOverrides = {},
): Promise<Harness> {
  const env = loadApiEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    PUBLIC_BASE_URL: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'integration-test-access-secret-0123456789',
    HASH_SECRET: 'integration-test-hash-secret-0123456789abc',
    CONSENT_VERSION: 'test-v1',
    OTP_BYPASS: 'true',
    MEDIA_DIR: '.data/test-media',
    ...overrides,
  });
  const devOtps: string[] = [];
  const logger = pino({ level: 'info' }, {
    write: (line: string) => {
      const code = JSON.parse(line).devOtp;
      if (code) devOtps.push(code);
    },
  });
  const container = createContainer(env, logger, containerOverrides);
  const app = await buildApp({ container, corsOrigins: [], logger });
  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();

  const harness: Harness = {
    app,
    container,
    db,
    env,
    devOtps,
    async reset() {
      const { rows } = await db.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
      );
      await db.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
      await container.redis?.flushdb();
      devOtps.length = 0;
    },
    async close() {
      await app.close();
      await container.close();
      await db.end();
    },
    async signUp(phone = nextPhone()) {
      const code = () => (env.OTP_BYPASS ? '123456' : (devOtps.at(-1) ?? ''));
      const start = await app.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        payload: { ...TEST_SIGNUP, phone },
      });
      if (start.statusCode !== 200) throw new Error(`signUp failed: ${start.body}`);
      let res = await app.inject({
        method: 'POST',
        url: '/v1/auth/signup/verify',
        payload: { signupId: start.json().signupId, code: code() },
      });
      if (res.statusCode === 409) {
        // Already registered: log in from a new device (password, then the device code).
        const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { phone, password: TEST_PASSWORD } });
        if (login.statusCode !== 200) throw new Error(`login failed: ${login.body}`);
        res = await app.inject({
          method: 'POST',
          url: '/v1/auth/login/verify',
          payload: { ticket: login.json().ticket, code: code() },
        });
      }
      if (res.statusCode !== 200) throw new Error(`signUp failed: ${res.body}`);
      const token = res.json().accessToken as string;
      const refresh = res.cookies.find((c) => c.name === 'hg_rt')?.value ?? '';
      const headers = { authorization: `Bearer ${token}` };
      return {
        token,
        refresh,
        headers,
        async request(opts) {
          const r = await app.inject({ ...opts, headers: { ...headers, ...opts.headers } } as InjectOptions);
          let body: unknown = r.body;
          try {
            body = r.json();
          } catch {
            /* non-JSON */
          }
          return { status: r.statusCode, body: body as never, headers: r.headers };
        },
      };
    },
  };
  return harness;
}

/** Fails if a response leaks account-level identifiers (golden rule, §3). */
export function assertNoAccountLeak(body: unknown, allowOwn: string[] = []): void {
  const text = JSON.stringify(body);
  for (const key of ['accountId', 'blockerAccountId', 'blockedAccountId', 'phone', 'email', 'pinHash']) {
    if (allowOwn.includes(key)) continue;
    if (text.includes(`"${key}"`)) throw new Error(`Response leaks "${key}": ${text.slice(0, 300)}`);
  }
}
