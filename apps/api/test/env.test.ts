import { describe, expect, it } from 'vitest';
import { loadApiEnv } from '../src/config/env.js';

/** The smallest production settings the API accepts: no Turnstile, email or payments yet. */
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://hellogram:pw@postgres:5432/hellogram',
  REDIS_URL: 'redis://redis:6379',
  PUBLIC_BASE_URL: 'https://hellogram.in',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  HASH_SECRET: 'b'.repeat(64),
  TRUST_PROXY: '1',
  TURN_SHARED_SECRET: 'c'.repeat(64),
  PHONE_AUTH_PROVIDER: 'otp',
  SMS_PROVIDER: 'twofactor',
  TWOFACTOR_API_KEY: 'key',
  EMAIL_PROVIDER: 'none',
  BILLING_PROVIDER: 'none',
  ATTACHMENT_STORAGE: 's3',
  ATTACHMENT_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  S3_BUCKET: 'bucket',
};

const problems = (overrides: Record<string, string | undefined>) => {
  try {
    loadApiEnv({ ...production, ...overrides });
    return [];
  } catch (error) {
    return (error as { issues?: string[] }).issues ?? [String(error)];
  }
};

describe('production settings', () => {
  it('start without Turnstile, email or payments', () => {
    expect(problems({})).toEqual([]);
  });

  it('treat empty values as not set (the template lists keys for every provider)', () => {
    expect(problems({ MESSAGECENTRAL_EMAIL: '', TURNSTILE_SECRET: '', SMTP_URL: '', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' })).toEqual([]);
  });

  it('refuse the development stand-ins that would log codes or fake payments', () => {
    expect(problems({ EMAIL_PROVIDER: 'console' }).join()).toMatch(/EMAIL_PROVIDER/);
    expect(problems({ BILLING_PROVIDER: 'dev' }).join()).toMatch(/BILLING_PROVIDER/);
  });

  it('still need the keys once a real provider is chosen', () => {
    expect(problems({ EMAIL_PROVIDER: 'smtp' }).join()).toMatch(/SMTP_URL/);
    expect(problems({ BILLING_PROVIDER: 'razorpay' }).join()).toMatch(/RAZORPAY_KEY_ID/);
  });
});
