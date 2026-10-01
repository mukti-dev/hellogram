import { FirebaseIdTokenVerifier } from '@hellogram/infrastructure';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createNumber } from './fixtures.js';
import { TEST_PASSWORD, TEST_SIGNUP, createHarness, type Harness } from './harness.js';

/**
 * Firebase Phone Auth. Google's signing keys are replaced by a local key pair so we can
 * mint tokens shaped exactly like Firebase ID tokens.
 */
const PROJECT = 'hellogram-test';
let h: Harness;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }] });
  h = await createHarness(
    { PHONE_AUTH_PROVIDER: 'firebase', FIREBASE_PROJECT_ID: PROJECT, OTP_BYPASS: 'false', SMS_PROVIDER: 'none' },
    { phoneVerifier: new FirebaseIdTokenVerifier(PROJECT, jwks) },
  );
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

const firebaseToken = (phone: string, authSecondsAgo = 5) =>
  new SignJWT({ phone_number: phone, auth_time: Math.floor(Date.now() / 1000) - authSecondsAgo, firebase: { sign_in_provider: 'phone' } })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(`https://securetoken.google.com/${PROJECT}`)
    .setAudience(PROJECT)
    .setSubject(`uid-${phone}`)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);

const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'POST', url, payload, headers });

/** Sign-up details, then the Firebase proof of the mobile in place of our own code. */
const signUpWith = async (phone: string, idToken: string) => {
  const start = await post('/v1/auth/signup', { ...TEST_SIGNUP, phone });
  expect(start.statusCode).toBe(200);
  return post('/v1/auth/signup/verify', { signupId: start.json().signupId, idToken });
};
const login = async (phone: string) => signUpWith(phone, await firebaseToken(phone));

describe('Firebase Phone Auth', () => {
  it('reports the mode to the web app', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/config' })).json()).toEqual({ phoneAuth: 'firebase', otpDelivery: 'sms', consentVersion: 'test-v1' });
  });

  it('signs up with a Firebase proof of the mobile; the server sends no SMS', async () => {
    const res = await login('+919876543210');
    expect(res.statusCode).toBe(200);
    expect(h.devOtps).toHaveLength(0);
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${res.json().accessToken}` } });
    expect(me.json().phone).toBe('+919876543210');
  });

  it('a new device proves the mobile with Firebase too', async () => {
    await login('+919876543210');
    const fresh = await post('/v1/auth/login', { phone: '9876543210', password: TEST_PASSWORD });
    expect(fresh.json().status).toBe('verify_device');
    const ok = await post('/v1/auth/login/verify', { ticket: fresh.json().ticket, idToken: await firebaseToken('+919876543210') });
    expect(ok.statusCode).toBe(200);
  });

  it('rejects stale verifications, proofs for another number, and garbage', async () => {
    expect((await signUpWith('+919876543210', await firebaseToken('+919876543210', 15 * 60))).json().error.code).toBe('OTP_EXPIRED');
    expect((await signUpWith('+919876543210', await firebaseToken('+919811111111'))).json().error.code).toBe('OTP_INVALID');
    expect((await signUpWith('+919876543210', 'x'.repeat(40))).json().error.code).toBe('OTP_INVALID');
  });

  it('PIN reset needs a fresh Firebase proof of *this account’s* phone', async () => {
    const res = await login('+919811100000');
    const headers = { authorization: `Bearer ${res.json().accessToken}` };
    const user = {
      token: res.json().accessToken,
      refresh: '',
      headers,
      request: async <T,>(o: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) => {
        const r = await h.app.inject({ ...o, headers: { ...headers, ...o.headers } } as never);
        return { status: r.statusCode, body: r.json() as T, headers: r.headers };
      },
    };
    const number = await createNumber(user as never, 'Locked');
    await user.request({ method: 'PUT', url: `/v1/personas/${number.id}/pin`, payload: { pin: '4826' } });

    const wrongPhone = await user.request<{ error: { code: string } }>({
      method: 'POST',
      url: `/v1/personas/${number.id}/pin/reset`,
      payload: { idToken: await firebaseToken('+919822200000'), newPin: '1111' },
    });
    expect(wrongPhone.body.error.code).toBe('OTP_INVALID');

    const ok = await user.request<{ unlockToken: string }>({
      method: 'POST',
      url: `/v1/personas/${number.id}/pin/reset`,
      payload: { idToken: await firebaseToken('+919811100000'), newPin: '1111' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.unlockToken).toBeTruthy();
  });
});
