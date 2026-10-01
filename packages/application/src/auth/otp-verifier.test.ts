import type { HostedSmsVerification } from '@hellogram/domain';
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeOtps, FakeSms, fakeCrypto } from '../testing/fakes.js';
import { OtpVerifier } from './otp-verifier.js';

const PHONE = '+919876543210';
const target = { targetHash: 'target-hash', purpose: 'login' as const, ipHash: 'ip' };

/** Stand-in for Message Central: its own codes, keyed by its reference. */
class FakeHosted implements HostedSmsVerification {
  sent: string[] = [];
  checks = 0;
  codes = new Map<string, string>();
  expired = new Set<string>();

  async send(phone: string) {
    const reference = `ref-${this.sent.length + 1}`;
    this.sent.push(phone);
    this.codes.set(reference, '654321');
    return { reference };
  }

  async check(_phone: string, reference: string, code: string) {
    this.checks += 1;
    if (this.expired.has(reference)) return 'expired' as const;
    return this.codes.get(reference) === code ? ('valid' as const) : ('invalid' as const);
  }
}

const setup = () => {
  const otps = new FakeOtps();
  const hosted = new FakeHosted();
  const sms = new FakeSms();
  const verifier = new OtpVerifier(otps, fakeCrypto, new FakeClock(), { bypass: false, sms, hosted });
  return { otps, hosted, sms, verifier };
};

const codeOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);

describe('OtpVerifier with a hosted verification service', () => {
  it('lets the service send the code and keeps only its reference', async () => {
    const { otps, hosted, sms, verifier } = setup();
    await verifier.sendSms(PHONE, target);
    expect(hosted.sent).toEqual([PHONE]);
    expect(sms.sent).toHaveLength(0);
    expect(otps.rows[0]).toMatchObject({ providerRef: 'ref-1', codeHash: '', channel: 'sms', purpose: 'login' });
  });

  it('asks the service to check the code, and the challenge is single-use', async () => {
    const { verifier } = setup();
    await verifier.sendSms(PHONE, target);
    expect(await codeOf(verifier.check('target-hash', 'login', '111111', PHONE))).toBe('OTP_INVALID');
    const challenge = await verifier.check('target-hash', 'login', '654321', PHONE);
    expect(challenge?.providerRef).toBe('ref-1');
    await verifier.consume(challenge!.id);
    expect(await codeOf(verifier.consume(challenge!.id))).toBe('OTP_EXPIRED');
  });

  it('still caps wrong guesses at 5, without asking the service again', async () => {
    const { hosted, verifier } = setup();
    await verifier.sendSms(PHONE, target);
    for (let i = 0; i < 4; i += 1) expect(await codeOf(verifier.check('target-hash', 'login', '000000', PHONE))).toBe('OTP_INVALID');
    expect(await codeOf(verifier.check('target-hash', 'login', '000000', PHONE))).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect(await codeOf(verifier.check('target-hash', 'login', '654321', PHONE))).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect(hosted.checks).toBe(5);
  });

  it('keeps the code valid for 10 minutes, as the SMS says', async () => {
    const clock = new FakeClock();
    const otps = new FakeOtps();
    const verifier = new OtpVerifier(otps, fakeCrypto, clock, { bypass: false, hosted: new FakeHosted() });
    await verifier.sendSms(PHONE, target);
    clock.advance(9 * 60 * 1000);
    expect(await verifier.check('target-hash', 'login', '654321', PHONE)).not.toBeNull();
    await verifier.sendSms(PHONE, target);
    clock.advance(10 * 60 * 1000 + 1);
    expect(await codeOf(verifier.check('target-hash', 'login', '654321', PHONE))).toBe('OTP_EXPIRED');
  });

  it('reports an expired code as expired', async () => {
    const { hosted, verifier } = setup();
    await verifier.sendSms(PHONE, target);
    hosted.expired.add('ref-1');
    expect(await codeOf(verifier.check('target-hash', 'login', '654321', PHONE))).toBe('OTP_EXPIRED');
  });

  it('rejects malformed codes before calling the service', async () => {
    const { hosted, verifier } = setup();
    await verifier.sendSms(PHONE, target);
    expect(await codeOf(verifier.check('target-hash', 'login', '12ab', PHONE))).toBe('OTP_INVALID');
    expect(hosted.checks).toBe(0);
  });

  it('without a hosted service, generates and delivers its own code as before', async () => {
    const otps = new FakeOtps();
    const sms = new FakeSms();
    const verifier = new OtpVerifier(otps, fakeCrypto, new FakeClock(), { bypass: false, sms });
    await verifier.sendSms(PHONE, target);
    expect(sms.sent).toHaveLength(1);
    expect(otps.rows[0]?.providerRef ?? null).toBeNull();
    expect(await verifier.check('target-hash', 'login', '123456', PHONE)).not.toBeNull();
  });
});
