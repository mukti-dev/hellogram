import { DomainError } from '@hellogram/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FakeAccounts,
  FakeClock,
  FakeEmail,
  FakeLimiter,
  FakeOtps,
  FakeSessions,
  FakeSms,
  FakeTokens,
  fakeCrypto,
  passthroughUow,
} from '../testing/fakes.js';
import { AuthService } from './auth.service.js';
import { OtpVerifier } from './otp-verifier.js';

const CONSENT = '2026-09-v1';
const client = { ip: '203.0.113.9', userAgent: 'Vitest', deviceName: 'Test device' };
const PHONE = '98765 43210';

function setup({ bypass = false } = {}) {
  const clock = new FakeClock();
  const accounts = new FakeAccounts();
  const sessions = new FakeSessions();
  const otps = new FakeOtps();
  const sms = new FakeSms();
  const email = new FakeEmail();
  const limiter = new FakeLimiter();
  const repos = { accounts, sessions, otps };
  const otp = new OtpVerifier(otps, fakeCrypto, clock, { bypass });
  const service = new AuthService(
    { repos, uow: passthroughUow(repos), otp, sms, email, crypto: fakeCrypto, tokens: new FakeTokens(), limiter, clock },
    { consentVersion: CONSENT, sessionTtlDays: 90 },
  );
  return { service, clock, accounts, sessions, otps, sms, email };
}

const signUp = (s: ReturnType<typeof setup>['service'], code = '123456') =>
  s.verifyPhoneOtp({ phone: PHONE, code, ageConfirmed: true, consentVersion: CONSENT }, client);

const errorCode = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error('expected a DomainError');
};

describe('AuthService — phone OTP (rule 1)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('sends a 6-digit code to the normalized phone', async () => {
    await ctx.service.sendPhoneOtp(PHONE, client);
    expect(ctx.sms.sent).toEqual([{ phone: '+919876543210', code: '123456' }]);
  });

  it('allows max 3 sends per 15 minutes per phone', async () => {
    for (let i = 0; i < 3; i++) await ctx.service.sendPhoneOtp(PHONE, client);
    expect(await errorCode(ctx.service.sendPhoneOtp(PHONE, client))).toBe('RATE_LIMITED');
  });

  it('rejects a wrong code and locks the challenge after 5 attempts', async () => {
    await ctx.service.sendPhoneOtp(PHONE, client);
    for (let i = 0; i < 4; i++) {
      expect(await errorCode(signUp(ctx.service, '000000'))).toBe('OTP_INVALID');
    }
    expect(await errorCode(signUp(ctx.service, '000000'))).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect(await errorCode(signUp(ctx.service, '123456'))).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('expires codes after 5 minutes', async () => {
    await ctx.service.sendPhoneOtp(PHONE, client);
    ctx.clock.advance(5 * 60 * 1000 + 1);
    expect(await errorCode(signUp(ctx.service))).toBe('OTP_EXPIRED');
  });

  it('rejects codes that are not 6 digits', async () => {
    await ctx.service.sendPhoneOtp(PHONE, client);
    expect(await errorCode(signUp(ctx.service, '12345'))).toBe('OTP_INVALID');
  });

  it('a code cannot be used twice', async () => {
    await ctx.service.sendPhoneOtp(PHONE, client);
    await signUp(ctx.service);
    expect(await errorCode(signUp(ctx.service))).toBe('OTP_EXPIRED');
  });
});

describe('AuthService — sign-up consent (rule 2)', () => {
  it('requires 18+ and the current consent version for new accounts, without burning the code', async () => {
    const ctx = setup();
    await ctx.service.sendPhoneOtp(PHONE, client);
    expect(await errorCode(ctx.service.verifyPhoneOtp({ phone: PHONE, code: '123456' }, client))).toBe(
      'AGE_CONFIRMATION_REQUIRED',
    );
    expect(
      await errorCode(
        ctx.service.verifyPhoneOtp({ phone: PHONE, code: '123456', ageConfirmed: true, consentVersion: 'old' }, client),
      ),
    ).toBe('AGE_CONFIRMATION_REQUIRED');

    const result = await signUp(ctx.service);
    expect(result.isNewAccount).toBe(true);
    expect(ctx.accounts.rows[0]).toMatchObject({ phone: '+919876543210', consentVersion: CONSENT });
  });

  it('existing accounts log in without re-confirming', async () => {
    const ctx = setup();
    await ctx.service.sendPhoneOtp(PHONE, client);
    await signUp(ctx.service);
    await ctx.service.sendPhoneOtp(PHONE, client);
    const result = await ctx.service.verifyPhoneOtp({ phone: PHONE, code: '123456' }, client);
    expect(result.isNewAccount).toBe(false);
    expect(ctx.accounts.rows).toHaveLength(1);
  });

  it('banned accounts cannot log in', async () => {
    const ctx = setup();
    await ctx.service.sendPhoneOtp(PHONE, client);
    await signUp(ctx.service);
    ctx.accounts.rows[0]!.status = 'banned';
    await ctx.service.sendPhoneOtp(PHONE, client);
    expect(await errorCode(signUp(ctx.service))).toBe('ACCOUNT_RESTRICTED');
  });
});

describe('AuthService — OTP bypass (testing only)', () => {
  it('accepts any 6-digit code, even without a prior send', async () => {
    const ctx = setup({ bypass: true });
    const result = await signUp(ctx.service, '987654');
    expect(result.isNewAccount).toBe(true);
  });

  it('still requires the 6-digit format and 18+ consent', async () => {
    const ctx = setup({ bypass: true });
    expect(await errorCode(signUp(ctx.service, 'abc'))).toBe('OTP_INVALID');
    expect(await errorCode(ctx.service.verifyPhoneOtp({ phone: PHONE, code: '111111' }, client))).toBe(
      'AGE_CONFIRMATION_REQUIRED',
    );
  });
});

describe('AuthService — sessions and refresh rotation (rule 3)', () => {
  it('rotates refresh tokens', async () => {
    const ctx = setup({ bypass: true });
    const login = await signUp(ctx.service);
    const first = await ctx.service.refresh(login.refreshToken);
    const second = await ctx.service.refresh(first.refreshToken);
    expect(second.accessToken).toBeTruthy();
  });

  it('revokes the whole session when an old refresh token is reused', async () => {
    const ctx = setup({ bypass: true });
    const login = await signUp(ctx.service);
    const rotated = await ctx.service.refresh(login.refreshToken);
    expect(await errorCode(ctx.service.refresh(login.refreshToken))).toBe('UNAUTHENTICATED');
    expect(await errorCode(ctx.service.refresh(rotated.refreshToken))).toBe('UNAUTHENTICATED');
    expect(ctx.sessions.sessions[0]).toMatchObject({ revokeReason: 'reuse_detected' });
  });

  it('logout revokes the session and its access tokens stop working', async () => {
    const ctx = setup({ bypass: true });
    const login = await signUp(ctx.service);
    expect(await ctx.service.authenticate(login.accessToken)).not.toBeNull();
    await ctx.service.logout(login.refreshToken);
    expect(await ctx.service.authenticate(login.accessToken)).toBeNull();
    expect(await errorCode(ctx.service.refresh(login.refreshToken))).toBe('UNAUTHENTICATED');
  });

  it('expired sessions cannot refresh', async () => {
    const ctx = setup({ bypass: true });
    const login = await signUp(ctx.service);
    ctx.clock.advance(91 * 24 * 60 * 60 * 1000);
    expect(await errorCode(ctx.service.refresh(login.refreshToken))).toBe('UNAUTHENTICATED');
  });
});

describe('AuthService — email login', () => {
  it('only sends codes to verified emails, but never reveals which exist', async () => {
    const ctx = setup();
    await ctx.service.sendEmailLoginOtp('nobody@example.com', client);
    expect(ctx.email.sent).toHaveLength(0);

    await ctx.service.sendPhoneOtp(PHONE, client);
    await signUp(ctx.service);
    await ctx.accounts.setVerifiedEmail(ctx.accounts.rows[0]!.id, 'me@example.com', new Date());
    await ctx.service.sendEmailLoginOtp(' Me@Example.com ', client);
    expect(ctx.email.sent).toEqual([{ email: 'me@example.com', code: '123456', purpose: 'login' }]);

    const result = await ctx.service.verifyEmailOtp({ email: 'me@example.com', code: '123456' }, client);
    expect(result.isNewAccount).toBe(false);
  });
});
