import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeTestContainer, TEST_CONSENT } from './helpers.js';

let app: FastifyInstance;
afterEach(async () => app?.close());

async function setup(options: { bypass?: boolean } = {}) {
  const ctx = makeTestContainer(options);
  app = await buildApp({ container: ctx.container, corsOrigins: ['http://localhost:5173'] });
  return ctx;
}

const PHONE = '9876543210';
const post = (url: string, payload?: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers });

const refreshCookie = (res: LightMyRequestResponse) => {
  const cookie = res.cookies.find((c) => c.name === 'hg_rt');
  return cookie?.value ?? '';
};

const signUp = async (code = '123456') => {
  const res = await post('/v1/auth/otp/verify', {
    phone: PHONE,
    code,
    ageConfirmed: true,
    consentVersion: TEST_CONSENT,
    deviceName: 'Chrome on macOS',
  });
  expect(res.statusCode).toBe(200);
  return { accessToken: res.json().accessToken as string, refresh: refreshCookie(res), res };
};

describe('POST /v1/auth/otp/*', () => {
  it('sign-up: send → verify requires 18+ consent → session with httpOnly refresh cookie', async () => {
    const { sms } = await setup();
    expect((await post('/v1/auth/otp/send', { phone: PHONE })).statusCode).toBe(204);
    expect(sms.sent).toHaveLength(1);

    const noConsent = await post('/v1/auth/otp/verify', { phone: PHONE, code: sms.sent[0]!.code });
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().error).toMatchObject({
      code: 'AGE_CONFIRMATION_REQUIRED',
      details: { consentVersion: TEST_CONSENT },
    });

    const { res } = await signUp(sms.sent[0]!.code);
    expect(res.json()).toMatchObject({ isNewAccount: true, expiresIn: 900 });
    expect(res.json()).not.toHaveProperty('refreshToken');
    const cookie = res.cookies.find((c) => c.name === 'hg_rt');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/v1/auth' });
  });

  it('rejects invalid phone numbers with VALIDATION_FAILED', async () => {
    await setup();
    const res = await post('/v1/auth/otp/send', { phone: '1234567890' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a wrong code', async () => {
    await setup();
    await post('/v1/auth/otp/send', { phone: PHONE });
    const res = await post('/v1/auth/otp/verify', {
      phone: PHONE,
      code: '000000',
      ageConfirmed: true,
      consentVersion: TEST_CONSENT,
    });
    expect(res.json().error.code).toBe('OTP_INVALID');
  });

  it('OTP bypass: any 6-digit code logs in', async () => {
    await setup({ bypass: true });
    const { res } = await signUp('424242');
    expect(res.statusCode).toBe(200);
  });
});

describe('/v1/me and sessions', () => {
  it('requires a valid access token', async () => {
    await setup();
    expect((await app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    const bad = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer nope' } });
    expect(bad.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the caller’s own account and devices', async () => {
    await setup({ bypass: true });
    const { accessToken } = await signUp();
    const auth = { authorization: `Bearer ${accessToken}` };

    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: auth });
    expect(me.json()).toMatchObject({ phone: '+919876543210', email: null, emailVerified: false });

    const sessions = await app.inject({ method: 'GET', url: '/v1/me/sessions', headers: auth });
    expect(sessions.json().items).toEqual([expect.objectContaining({ deviceName: 'Chrome on macOS', current: true })]);
  });

  it('remote logout kills the other device immediately (rule 3)', async () => {
    await setup({ bypass: true });
    const laptop = await signUp();
    const phone = await signUp();
    const sessions = await app.inject({
      method: 'GET',
      url: '/v1/me/sessions',
      headers: { authorization: `Bearer ${laptop.accessToken}` },
    });
    const other = sessions.json().items.find((s: { current: boolean }) => !s.current);

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/me/sessions/${other.id}`,
      headers: { authorization: `Bearer ${laptop.accessToken}` },
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${phone.accessToken}` } });
    expect(after.statusCode).toBe(401);
  });
});

describe('POST /v1/auth/refresh and logout', () => {
  const withCookie = (token: string) => ({ cookie: `hg_rt=${token}`, 'x-hellogram-client': 'web' });

  it('needs the client header (CSRF defence)', async () => {
    await setup({ bypass: true });
    const { refresh } = await signUp();
    const res = await post('/v1/auth/refresh', undefined, { cookie: `hg_rt=${refresh}` });
    expect(res.statusCode).toBe(403);
  });

  it('rotates the cookie, and reusing the old one ends the session', async () => {
    await setup({ bypass: true });
    const { refresh } = await signUp();

    const first = await post('/v1/auth/refresh', undefined, withCookie(refresh));
    expect(first.statusCode).toBe(200);
    const rotated = refreshCookie(first);
    expect(rotated).not.toBe(refresh);

    const reuse = await post('/v1/auth/refresh', undefined, withCookie(refresh));
    expect(reuse.statusCode).toBe(401);
    expect((await post('/v1/auth/refresh', undefined, withCookie(rotated))).statusCode).toBe(401);
  });

  it('logout clears the cookie and revokes the session', async () => {
    await setup({ bypass: true });
    const { refresh, accessToken } = await signUp();
    const res = await post('/v1/auth/logout', undefined, withCookie(refresh));
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === 'hg_rt')?.value).toBe('');
    const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(me.statusCode).toBe(401);
  });
});
