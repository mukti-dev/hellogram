import type { HostedSmsVerification } from '@hellogram/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_SIGNUP, createHarness, nextPhone, type Harness } from './harness.js';

/** Stand-in for Message Central VerifyNow: it makes the code and checks it. */
class FakeVerifyNow implements HostedSmsVerification {
  sent: { phone: string; reference: string; code: string }[] = [];
  async send(phone: string) {
    const entry = { phone, reference: String(1000 + this.sent.length), code: String(700000 + this.sent.length) };
    this.sent.push(entry);
    return { reference: entry.reference };
  }
  async check(phone: string, reference: string, code: string) {
    const entry = this.sent.find((s) => s.reference === reference);
    if (!entry || entry.phone !== phone) return 'expired' as const;
    return entry.code === code ? ('valid' as const) : ('invalid' as const);
  }
}

let h: Harness;
const verifyNow = new FakeVerifyNow();
beforeAll(async () => {
  // Real codes: no bypass.
  h = await createHarness({ OTP_BYPASS: 'false' }, { hostedSms: verifyNow });
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  verifyNow.sent.length = 0;
});

/** Sign-up details → the service sends the code; returns the sign-up id. */
const send = async (phone: string) => {
  const res = await h.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { ...TEST_SIGNUP, phone } });
  expect(res.statusCode).toBe(200);
  return res.json().signupId as string;
};
const verify = (signupId: string, code: string) =>
  h.app.inject({ method: 'POST', url: '/v1/auth/signup/verify', payload: { signupId, code } });

describe('sign-up with a hosted verification service (2Factor / Message Central)', () => {
  it('the service sends the code; the right code signs in, once', async () => {
    const phone = nextPhone();
    const signup = await send(phone);
    expect(verifyNow.sent).toHaveLength(1);
    expect(verifyNow.sent[0]!.phone).toBe(`+91${phone}`);
    expect(h.devOtps).toHaveLength(0); // our server never saw or logged a code

    const wrong = await verify(signup, '111111');
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('OTP_INVALID');

    const ok = await verify(signup, verifyNow.sent[0]!.code);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBeTruthy();

    const again = await verify(signup, verifyNow.sent[0]!.code);
    expect(again.statusCode).toBe(400);
  });

  it('keeps our own limit of 5 wrong attempts per code', async () => {
    const signup = await send(nextPhone());
    for (let i = 0; i < 4; i += 1) expect((await verify(signup, '000000')).json().error.code).toBe('OTP_INVALID');
    expect((await verify(signup, '000000')).json().error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect((await verify(signup, verifyNow.sent[0]!.code)).json().error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('a code for one number cannot sign in another', async () => {
    await send(nextPhone());
    const other = await send(nextPhone());
    const res = await verify(other, verifyNow.sent[0]!.code);
    expect(res.statusCode).toBe(400);
  });
});

describe('how codes are delivered (/auth/config)', () => {
  it('tells the app a call is possible with 2Factor, and SMS otherwise', async () => {
    const config = async (overrides: Record<string, string>) => {
      const harness = await createHarness(overrides, { hostedSms: verifyNow });
      try {
        return (await harness.app.inject({ method: 'GET', url: '/v1/auth/config' })).json();
      } finally {
        await harness.close();
      }
    };
    expect(await config({ SMS_PROVIDER: 'twofactor', TWOFACTOR_API_KEY: 'test-key', PHONE_AUTH_PROVIDER: 'otp' })).toEqual({
      phoneAuth: 'otp',
      otpDelivery: 'call_or_sms',
      consentVersion: 'test-v1',
    });
    expect(await config({})).toEqual({ phoneAuth: 'otp', otpDelivery: 'sms', consentVersion: 'test-v1' });
  });
});
