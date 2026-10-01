import { DomainError } from '@hellogram/domain';
import { describe, expect, it } from 'vitest';
import { OtpVerifier } from '../auth/otp-verifier.js';
import { FakeAccounts, FakeClock, FakeEmail, FakeLimiter, FakeOtps, FakeSessions, FakeTrustedDevices, fakeCrypto } from '../testing/fakes.js';
import { AccountService } from './account.service.js';

async function setup() {
  const clock = new FakeClock();
  const accounts = new FakeAccounts();
  const sessions = new FakeSessions();
  const email = new FakeEmail();
  const trustedDevices = new FakeTrustedDevices();
  const otp = new OtpVerifier(new FakeOtps(), fakeCrypto, clock, { bypass: false });
  const service = new AccountService({
    accounts,
    sessions,
    trustedDevices,
    otp,
    email,
    crypto: fakeCrypto,
    limiter: new FakeLimiter(),
    clock,
  });
  const account = await accounts.create({ phone: '+919876543210', ageConfirmedAt: clock.now(), consentVersion: 'v1' });
  const expiresAt = new Date(clock.now().getTime() + 86_400_000);
  const s1 = await sessions.create({ accountId: account.id, deviceName: 'Laptop', userAgent: null, expiresAt });
  const s2 = await sessions.create({ accountId: account.id, deviceName: 'Phone', userAgent: null, deviceHash: 'phone-device', expiresAt });
  await trustedDevices.trust(account.id, 'phone-device');
  return { service, accounts, sessions, trustedDevices, email, actor: { accountId: account.id, sessionId: s1.id }, s2 };
}

describe('AccountService', () => {
  it('logging out another device makes that device verify the mobile again', async () => {
    const { service, trustedDevices, actor, s2 } = await setup();
    await service.revokeSession(actor, s2.id);
    expect(await trustedDevices.isTrusted(actor.accountId, 'phone-device')).toBe(false);
  });

  it('returns the caller’s own phone on /me', async () => {
    const { service, actor } = await setup();
    await expect(service.getMe(actor)).resolves.toMatchObject({ phone: '+919876543210', emailVerified: false });
  });

  it('lists devices and marks the current one (rule 3)', async () => {
    const { service, actor } = await setup();
    const list = await service.listSessions(actor);
    expect(list.map((s) => [s.deviceName, s.current])).toEqual([
      ['Laptop', true],
      ['Phone', false],
    ]);
  });

  it('logs out another device remotely, but never another account’s device', async () => {
    const { service, actor, s2, sessions } = await setup();
    await service.revokeSession(actor, s2.id);
    expect((await service.listSessions(actor)).map((s) => s.deviceName)).toEqual(['Laptop']);

    const other = await sessions.create({ accountId: 'someone-else', deviceName: 'X', userAgent: null, expiresAt: new Date(Date.now() + 1e9) });
    await expect(service.revokeSession(actor, other.id)).rejects.toBeInstanceOf(DomainError);
  });

  it('verifies a recovery email with an OTP', async () => {
    const { service, actor, email } = await setup();
    await service.startEmailVerification(actor, 'Me@Example.com', '1.1.1.1');
    expect(email.sent[0]).toMatchObject({ email: 'me@example.com', purpose: 'verify' });
    await service.confirmEmail(actor, 'me@example.com', email.sent[0]!.code);
    await expect(service.getMe(actor)).resolves.toMatchObject({ email: 'me@example.com', emailVerified: true });
  });

  it('refuses an email already linked to another account', async () => {
    const { service, actor, accounts, email } = await setup();
    const other = await accounts.create({ phone: '+919000000000', ageConfirmedAt: new Date(), consentVersion: 'v1' });
    await accounts.setVerifiedEmail(other.id, 'taken@example.com', new Date());
    await service.startEmailVerification(actor, 'taken@example.com', '1.1.1.1');
    await expect(service.confirmEmail(actor, 'taken@example.com', email.sent[0]!.code)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
