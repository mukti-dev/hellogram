import {
  DomainError,
  OTP_RULES,
  isOtpFormat,
  type Clock,
  type CryptoService,
  type OtpChallenge,
  type OtpChallengeRepository,
  type OtpPurpose,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

export interface OtpVerifierOptions {
  /**
   * TESTING ONLY: accept any 6-digit code. The API config refuses to start with
   * this enabled in production.
   */
  bypass: boolean;
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

  /**
   * Validates a code without consuming it. Returns the challenge (null in bypass
   * mode when none exists) so the caller can consume it inside its transaction.
   */
  async check(targetHash: string, purpose: OtpPurpose, code: string): Promise<OtpChallenge | null> {
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
    if (!this.crypto.safeEqual(challenge.codeHash, this.hashCode(targetHash, code))) {
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

  private hashCode(targetHash: string, code: string): string {
    return this.crypto.hmac('otp', `${targetHash}:${code}`);
  }
}
