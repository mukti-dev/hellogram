import {
  DomainError,
  OTP_RULES,
  isOtpFormat,
  type Clock,
  type CryptoService,
  type HostedSmsVerification,
  type OtpChallenge,
  type OtpChallengeRepository,
  type OtpPurpose,
  type SmsProvider,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

export interface OtpVerifierOptions {
  /**
   * TESTING ONLY: accept any 6-digit code. The API config refuses to start with
   * this enabled in production.
   */
  bypass: boolean;
  /** Delivers codes we generate (MSG91, Fast2SMS, console in development). */
  sms?: SmsProvider;
  /** Or: a service that makes and checks the code itself (Message Central). Takes precedence. */
  hosted?: HostedSmsVerification | null;
}

/** Message Central's SMS tells people the code is "valid for 10 minutes", so our challenge must last as long. */
const HOSTED_TTL_MS = 10 * 60 * 1000;

export interface OtpTarget {
  targetHash: string;
  purpose: OtpPurpose;
  ipHash: string;
}

/** Issues and checks OTP challenges. Shared by login, email login and email verification. */
export class OtpVerifier {
  constructor(
    private readonly otps: OtpChallengeRepository,
    private readonly crypto: CryptoService,
    private readonly clock: Clock,
    private readonly options: OtpVerifierOptions,
  ) {}

  /** Creates a challenge and returns the plain code for the caller to deliver. */
  async issue(input: {
    channel: 'sms' | 'email';
    targetHash: string;
    purpose: OtpPurpose;
    ipHash: string;
  }): Promise<string> {
    const code = this.crypto.randomDigits(OTP_RULES.length);
    await this.otps.create({
      ...input,
      codeHash: this.hashCode(input.targetHash, code),
      expiresAt: new Date(this.clock.now().getTime() + OTP_RULES.ttlMs),
    });
    return code;
  }

  /** Creates an SMS challenge and gets the code to `phone`, by whichever route is configured. */
  async sendSms(phone: string, target: OtpTarget): Promise<void> {
    if (this.options.hosted) {
      const { reference } = await this.options.hosted.send(phone);
      const expiresAt = new Date(this.clock.now().getTime() + HOSTED_TTL_MS);
      await this.otps.create({ ...target, channel: 'sms', codeHash: '', providerRef: reference, expiresAt });
      return;
    }
    if (!this.options.sms) throw new DomainError(ErrorCode.SERVICE_UNAVAILABLE, 'SMS is not set up');
    const code = await this.issue({ ...target, channel: 'sms' });
    await this.options.sms.sendOtp(phone, code);
  }

  /**
   * Validates a code without consuming it. Returns the challenge (null in bypass
   * mode when none exists) so the caller can consume it inside its transaction.
   */
  async check(targetHash: string, purpose: OtpPurpose, code: string, phone?: string): Promise<OtpChallenge | null> {
    if (!isOtpFormat(code)) {
      throw new DomainError(ErrorCode.OTP_INVALID, 'Enter the 6-digit code');
    }

    const challenge = await this.otps.findLatestOpen(targetHash, purpose, this.clock.now());
    if (this.options.bypass) return challenge;

    if (!challenge) {
      throw new DomainError(ErrorCode.OTP_EXPIRED, 'This code has expired. Request a new one.');
    }
    const attemptsBefore = challenge.attempts;
    // Reserve the attempt atomically *before* comparing, so parallel guesses can't exceed 5.
    if (!(await this.otps.reserveAttempt(challenge.id, OTP_RULES.maxAttempts))) {
      throw new DomainError(ErrorCode.OTP_TOO_MANY_ATTEMPTS, 'Too many wrong attempts. Request a new code.');
    }
    const result = challenge.providerRef
      ? await this.checkHosted(challenge.providerRef, code, phone)
      : this.crypto.safeEqual(challenge.codeHash, this.hashCode(targetHash, code))
        ? 'valid'
        : 'invalid';
    if (result === 'expired') throw new DomainError(ErrorCode.OTP_EXPIRED, 'This code has expired. Request a new one.');
    if (result === 'invalid') {
      const exhausted = attemptsBefore + 1 >= OTP_RULES.maxAttempts;
      throw exhausted
        ? new DomainError(ErrorCode.OTP_TOO_MANY_ATTEMPTS, 'Too many wrong attempts. Request a new code.')
        : new DomainError(ErrorCode.OTP_INVALID, 'That code is incorrect');
    }
    return challenge;
  }

  /** Throws if the code was already used (e.g. two concurrent verifies with one code). */
  async consume(challengeId: string): Promise<void> {
    if (!(await this.otps.consume(challengeId, this.clock.now()))) {
      throw new DomainError(ErrorCode.OTP_EXPIRED, 'This code has already been used. Request a new one.');
    }
  }

  private checkHosted(reference: string, code: string, phone: string | undefined) {
    if (!this.options.hosted || !phone) {
      // Sent through a provider that is no longer configured: the user just needs a new code.
      return Promise.resolve('expired' as const);
    }
    return this.options.hosted.check(phone, reference, code);
  }

  private hashCode(targetHash: string, code: string): string {
    return this.crypto.hmac('otp', `${targetHash}:${code}`);
  }
}
