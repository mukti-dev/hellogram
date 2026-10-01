import type { PendingDeviceLogin, PendingSignup } from '@hellogram/domain';
import { describe, expect, it } from 'vitest';
import {
  FakeAccounts,
  FakeClock,
  FakeEphemeralStore,
  FakeLimiter,
  FakeOtps,
  FakeSessions,
  FakeSms,
  FakeTokens,
  FakeTrustedDevices,
  fakeCrypto,
  fakePasswords,
  passthroughUow,
} from '../testing/fakes.js';
import { AuthService, type SignupInput } from './auth.service.js';
import { OtpVerifier } from './otp-verifier.js';
import { PhoneProofChecker } from './phone-proof.js';

const CONSENT = '2026-09-v1';
const client = { ip: '203.0.113.9', userAgent: 'Vitest', deviceName: 'Test device' };
const PHONE = '98765 43210';
const E164 = '+919876543210';
const PASSWORD = 'Sunrise!42';

function setup() {
  const clock = new FakeClock(new Date('2026-10-02T06:30:00Z'));
  const accounts = new FakeAccounts();
  const sessions = new FakeSessions();
  const otps = new FakeOtps();
  const trustedDevices = new FakeTrustedDevices();
  const sms = new FakeSms();
  const limiter = new FakeLimiter();
  const repos = { accounts, sessions, otps, trustedDevices };
  const otp = new OtpVerifier(otps, fakeCrypto, clock, { bypass: false, sms });
  const pendingSignups = new FakeEphemeralStore<PendingSignup>();
  const deviceLogins = new FakeEphemeralStore<PendingDeviceLogin>();
  const service = new AuthService(
    {
      repos,
      uow: passthroughUow(repos),
      otp,
      proofs: new PhoneProofChecker({ otp, firebase: null, clock }),
      passwords: fakePasswords,
      pendingSignups,
      deviceLogins,
      crypto: fakeCrypto,
      tokens: new FakeTokens(),
      limiter,
      clock,
    },
    { consentVersion: CONSENT, sessionTtlDays: 90 },
  );
  return { service, clock, accounts, sessions, otps, sms, trustedDevices, pendingSignups, deviceLogins };
}

const details = (over: Partial<SignupInput> = {}): SignupInput => ({
  name: 'Mukti Prasad',
  phone: PHONE,
  dateOfBirth: '1995-05-10',
  gender: 'male',
  password: PASSWORD,
  termsAccepted: true,
  consentVersion: CONSENT,
  ...over,
});

const errorCode = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'other');

/** Signs up and returns the login result (this device becomes trusted). */
async function signUp(ctx: ReturnType<typeof setup>, deviceId?: string) {
  const { signupId } = await ctx.service.startSignup(details(), client);
  return ctx.service.completeSignup({ signupId, proof: { code: '123456' }, deviceId }, client);
}

describe('sign-up', () => {
  it('checks the details, texts a code, and creates the account only after the code', async () => {
    const ctx = setup();
    const { signupId } = await ctx.service.startSignup(details(), client);
    expect(ctx.sms.sent).toEqual([{ phone: E164, code: '123456' }]);
    expect(ctx.accounts.rows).toHaveLength(0);
    // The pending sign-up never holds the plain password.
    expect(JSON.stringify([...ctx.pendingSignups.values.values()])).not.toContain(`"${PASSWORD}"`);

    expect(await errorCode(ctx.service.completeSignup({ signupId, proof: { code: '000000' } }, client))).toBe('OTP_INVALID');
    const result = await ctx.service.completeSignup({ signupId, proof: { code: '123456' } }, client);
    expect(result.accessToken).toBeTruthy();
    expect(result.deviceId).toBeTruthy();
    expect(ctx.accounts.rows[0]).toMatchObject({ phone: E164, name: 'Mukti Prasad', gender: 'male' });
    expect(ctx.accounts.rows[0]!.dateOfBirth?.toISOString().slice(0, 10)).toBe('1995-05-10');
    expect(ctx.trustedDevices.rows).toHaveLength(1);
    expect(ctx.pendingSignups.values.size).toBe(0);
  });

  it('refuses under-18s, weak passwords, bad genders and missing consent — before any SMS', async () => {
    const ctx = setup();
    expect(await errorCode(ctx.service.startSignup(details({ dateOfBirth: '2010-01-01' }), client))).toBe('UNDER_AGE');
    expect(await errorCode(ctx.service.startSignup(details({ password: 'password' }), client))).toBe('VALIDATION_FAILED');
    expect(await errorCode(ctx.service.startSignup(details({ gender: 'unknown' }), client))).toBe('VALIDATION_FAILED');
    expect(await errorCode(ctx.service.startSignup(details({ termsAccepted: false }), client))).toBe('VALIDATION_FAILED');
    expect(await errorCode(ctx.service.startSignup(details({ name: '   ' }), client))).toBe('VALIDATION_FAILED');
    expect(ctx.sms.sent).toHaveLength(0);
  });

  it('only says a number is taken after its owner proves it with the code', async () => {
    const ctx = setup();
    await signUp(ctx);
    const { signupId } = await ctx.service.startSignup(details({ name: 'Someone Else' }), client); // looks normal
    expect(await errorCode(ctx.service.completeSignup({ signupId, proof: { code: '123456' } }, client))).toBe('ACCOUNT_EXISTS');
    expect(ctx.accounts.rows).toHaveLength(1);
  });

  it('allows max 3 codes per 15 minutes per number', async () => {
    const ctx = setup();
    for (let i = 0; i < 3; i += 1) await ctx.service.startSignup(details(), client);
    expect(await errorCode(ctx.service.startSignup(details(), client))).toBe('RATE_LIMITED');
  });
});

describe('login', () => {
  it('on a verified device: mobile + password is enough', async () => {
    const ctx = setup();
    const { deviceId } = await signUp(ctx);
    ctx.sms.sent.length = 0;
    const result = await ctx.service.login({ phone: PHONE, password: PASSWORD, deviceId }, client);
    expect(result.status).toBe('ok');
    expect(ctx.sms.sent).toHaveLength(0);
  });

  it('on a new device: correct password, then a one-time code; afterwards the device is remembered', async () => {
    const ctx = setup();
    await signUp(ctx);
    ctx.sms.sent.length = 0;
    const first = await ctx.service.login({ phone: PHONE, password: PASSWORD }, client);
    expect(first.status).toBe('verify_device');
    expect(ctx.sms.sent).toHaveLength(1);
    if (first.status !== 'verify_device') throw new Error('expected verify_device');

    const verified = await ctx.service.verifyDevice({ ticket: first.ticket, proof: { code: '123456' } }, client);
    const again = await ctx.service.login({ phone: PHONE, password: PASSWORD, deviceId: verified.deviceId }, client);
    expect(again.status).toBe('ok');
    expect(ctx.sms.sent).toHaveLength(1);
  });

  it('a wrong password never sends a code, and looks the same as an unknown number', async () => {
    const ctx = setup();
    await signUp(ctx);
    ctx.sms.sent.length = 0;
    const wrong = await ctx.service.login({ phone: PHONE, password: 'not-it-at-all' }, client).catch((e: Error) => e);
    const unknown = await ctx.service.login({ phone: '91234 56789', password: PASSWORD }, client).catch((e: Error) => e);
    expect(wrong).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Mobile number or password is incorrect' });
    expect(unknown).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Mobile number or password is incorrect' });
    expect(ctx.sms.sent).toHaveLength(0);
  });

  it('limits password guesses per number', async () => {
    const ctx = setup();
    await signUp(ctx);
    for (let i = 0; i < 10; i += 1) await ctx.service.login({ phone: PHONE, password: 'wrong-guess' }, client).catch(() => undefined);
    expect(await errorCode(ctx.service.login({ phone: PHONE, password: PASSWORD }, client))).toBe('RATE_LIMITED');
  });

  it('banned accounts cannot log in', async () => {
    const ctx = setup();
    const { deviceId } = await signUp(ctx);
    ctx.accounts.rows[0]!.status = 'banned';
    expect(await errorCode(ctx.service.login({ phone: PHONE, password: PASSWORD, deviceId }, client))).toBe('ACCOUNT_RESTRICTED');
  });
});

describe('forgot password', () => {
  it('never reveals whether a number has an account', async () => {
    const ctx = setup();
    await ctx.service.forgotPassword('91234 56789', client);
    expect(ctx.sms.sent).toHaveLength(0);
  });

  it('sets a new password and signs out every other device, which must verify again', async () => {
    const ctx = setup();
    const old = await signUp(ctx);
    ctx.sms.sent.length = 0;
    await ctx.service.forgotPassword(PHONE, client);
    expect(ctx.sms.sent).toHaveLength(1);

    const reset = await ctx.service.resetPassword({ phone: PHONE, proof: { code: '123456' }, password: 'New-Sunrise!77' }, client);
    expect(reset.accessToken).toBeTruthy();
    expect(await ctx.service.authenticate(old.accessToken)).toBeNull();
    expect(await errorCode(ctx.service.login({ phone: PHONE, password: PASSWORD, deviceId: old.deviceId }, client))).toBe('INVALID_CREDENTIALS');
    const oldDevice = await ctx.service.login({ phone: PHONE, password: 'New-Sunrise!77', deviceId: old.deviceId }, client);
    expect(oldDevice.status).toBe('verify_device');
  });
});

describe('sessions and refresh rotation (rule 3)', () => {
  it('rotates refresh tokens, and a reused one revokes the session', async () => {
    const ctx = setup();
    const login = await signUp(ctx);
    const rotated = await ctx.service.refresh(login.refreshToken);
    expect(await errorCode(ctx.service.refresh(login.refreshToken))).toBe('UNAUTHENTICATED');
    expect(await errorCode(ctx.service.refresh(rotated.refreshToken))).toBe('UNAUTHENTICATED');
    expect(ctx.sessions.sessions[0]).toMatchObject({ revokeReason: 'reuse_detected' });
  });

  it('logout revokes the session and its access tokens stop working', async () => {
    const ctx = setup();
    const login = await signUp(ctx);
    expect(await ctx.service.authenticate(login.accessToken)).not.toBeNull();
    await ctx.service.logout(login.refreshToken);
    expect(await ctx.service.authenticate(login.accessToken)).toBeNull();
  });

  it('expired sessions cannot refresh', async () => {
    const ctx = setup();
    const login = await signUp(ctx);
    ctx.clock.advance(91 * 24 * 60 * 60 * 1000);
    expect(await errorCode(ctx.service.refresh(login.refreshToken))).toBe('UNAUTHENTICATED');
  });
});
