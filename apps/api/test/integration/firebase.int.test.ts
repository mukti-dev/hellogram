import { FirebaseIdTokenVerifier } from '@hellogram/infrastructure';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createNumber } from './fixtures.js';
import { createHarness, type Harness } from './harness.js';

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

const login = async (idToken: string, consent = true) =>
  h.app.inject({
    method: 'POST',
    url: '/v1/auth/firebase',
    payload: { idToken, ...(consent ? { ageConfirmed: true, consentVersion: 'test-v1' } : {}) },
  });

describe('Firebase Phone Auth', () => {
  it('reports the mode to the web app', async () => {
    expect((await h.app.inject({ method: 'GET', url: '/v1/auth/config' })).json()).toEqual({ phoneAuth: 'firebase' });
  });

  it('signs up with a Firebase token: 18+ consent, then a normal session', async () => {
    const token = await firebaseToken('+919876543210');
    const noConsent = await login(token, false);
    expect(noConsent.json().error.code).toBe('AGE_CONFIRMATION_REQUIRED');

    const res = await login(token);
    expect(res.statusCode).toBe(200);
    expect(res.json().isNewAccount).toBe(true);
    const me = await h.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${res.json().accessToken}` } });
    expect(me.json().phone).toBe('+919876543210');

    // Same number again → same account.
    expect((await login(await firebaseToken('+919876543210'))).json().isNewAccount).toBe(false);
  });

  it('rejects stale verifications, foreign numbers and garbage', async () => {
    expect((await login(await firebaseToken('+919876543210', 15 * 60))).json().error.code).toBe('OTP_EXPIRED');
    expect((await login(await firebaseToken('+14155550100'))).json().error.code).toBe('VALIDATION_FAILED');
    expect((await login('x'.repeat(40))).json().error.code).toBe('OTP_INVALID');
  });

  it('server-side OTP sending is off (Google sends the SMS)', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/auth/otp/send', payload: { phone: '9876543210' } });
    expect(res.statusCode).toBe(503);
  });

  it('PIN reset needs a fresh Firebase proof of *this account’s* phone', async () => {
    const res = await login(await firebaseToken('+919811100000'));
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
