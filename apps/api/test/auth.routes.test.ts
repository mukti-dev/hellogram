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

const PASSWORD = 'Sunrise!42';
const details = {
  name: 'Mukti Prasad',
  phone: PHONE,
  dateOfBirth: '1995-05-10',
  gender: 'male',
  password: PASSWORD,
  termsAccepted: true,
  consentVersion: TEST_CONSENT,
};
const cookieOf = (res: LightMyRequestResponse, name: string) => res.cookies.find((c) => c.name === name);

/** Sign-up with the (bypass) code; this device becomes trusted. */
const signUp = async (code = '123456') => {
  const start = await post('/v1/auth/signup', details);
  expect(start.statusCode).toBe(200);
  const res = await post('/v1/auth/signup/verify', { signupId: start.json().signupId, code, deviceName: 'Chrome on macOS' });
  expect(res.statusCode).toBe(200);
  return { accessToken: res.json().accessToken as string, refresh: refreshCookie(res), device: cookieOf(res, 'hg_dev')!.value, res };
};

/** Password login from a device that hasn't verified the mobile yet. */
const loginNewDevice = async (deviceName = 'Phone') => {
  const res = await post('/v1/auth/login', { phone: PHONE, password: PASSWORD, deviceName });
  expect(res.json()).toMatchObject({ status: 'verify_device' });
  const verified = await post('/v1/auth/login/verify', { ticket: res.json().ticket, code: '123456', deviceName });
  expect(verified.statusCode).toBe(200);
  return { accessToken: verified.json().accessToken as string };
};

describe('sign-up and login', () => {
  it('sign-up: details → code to the mobile → session with httpOnly refresh and device cookies', async () => {
    const { sms } = await setup();
    const start = await post('/v1/auth/signup', details);
    expect(start.statusCode).toBe(200);
    expect(sms.sent).toHaveLength(1);

    const res = await post('/v1/auth/signup/verify', { signupId: start.json().signupId, code: sms.sent[0]!.code });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ expiresIn: 900 });
    expect(res.json()).not.toHaveProperty('refreshToken');
    expect(cookieOf(res, 'hg_rt')).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/v1/auth' });
    expect(cookieOf(res, 'hg_dev')).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/v1/auth' });
  });

  it('refuses under-18s and bad input with clear errors', async () => {
    await setup();
    const young = await post('/v1/auth/signup', { ...details, dateOfBirth: '2012-04-01' });
    expect(young.statusCode).toBe(422);
    expect(young.json().error.code).toBe('UNDER_AGE');
    const badPhone = await post('/v1/auth/signup', { ...details, phone: '1234567890' });
    expect(badPhone.json().error.code).toBe('VALIDATION_FAILED');
    const noTerms = await post('/v1/auth/signup', { ...details, termsAccepted: false });
    expect(noTerms.statusCode).toBe(400);
  });

  it('login: same device needs only the password; a new device verifies the mobile once', async () => {
    const { sms } = await setup({ bypass: true });
    const { device } = await signUp();
    sms.sent.length = 0;

    const sameDevice = await post('/v1/auth/login', { phone: PHONE, password: PASSWORD }, { cookie: `hg_dev=${device}` });
    expect(sameDevice.json()).toMatchObject({ status: 'ok', expiresIn: 900 });
    expect(sms.sent).toHaveLength(0);

    const newDevice = await post('/v1/auth/login', { phone: PHONE, password: PASSWORD });
    expect(newDevice.json()).toMatchObject({ status: 'verify_device' });
    expect(newDevice.json()).not.toHaveProperty('accessToken');
    expect(sms.sent).toHaveLength(1);
  });

  it('wrong password: 400 with one generic message (no 401, no SMS)', async () => {
    const { sms } = await setup({ bypass: true });
    await signUp();
    sms.sent.length = 0;
    const res = await post('/v1/auth/login', { phone: PHONE, password: 'not-the-password' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Mobile number or password is incorrect' });
    expect(sms.sent).toHaveLength(0);
  });

  it('the old code-only login endpoints are gone', async () => {
    await setup({ bypass: true });
    for (const url of ['/v1/auth/otp/send', '/v1/auth/otp/verify', '/v1/auth/email/otp/send', '/v1/auth/email/otp/verify', '/v1/auth/firebase']) {
      expect((await post(url, { phone: PHONE, code: '123456' })).statusCode).toBe(404);
    }
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
    expect(me.json()).toMatchObject({
      phone: '+919876543210',
      name: 'Mukti Prasad',
      dateOfBirth: '1995-05-10',
      gender: 'male',
      email: null,
      emailVerified: false,
    });

    const sessions = await app.inject({ method: 'GET', url: '/v1/me/sessions', headers: auth });
    expect(sessions.json().items).toEqual([expect.objectContaining({ deviceName: 'Chrome on macOS', current: true })]);
  });

  it('remote logout kills the other device immediately (rule 3)', async () => {
    await setup({ bypass: true });
    const laptop = await signUp();
    const phone = await loginNewDevice();
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
