import {
  DomainError,
  normalizeIndianMobile,
  type Clock,
  type OtpPurpose,
  type PhoneIdentityVerifier,
  type PhoneProof,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { OtpVerifier } from './otp-verifier.js';

/** Firebase proofs must be fresh: the SMS step has to have happened just now. */
const MAX_PROOF_AGE_MS = 10 * 60 * 1000;

export interface ProofResult {
  /** The verified phone (E.164). */
  phone: string;
  /** Marks an OTP challenge as used; a no-op for Firebase proofs. Call inside the success path. */
  consume: () => Promise<void>;
}

/**
 * Checks a PhoneProof. OTP codes are checked against our own challenges;
 * Firebase ID tokens are verified with Google's keys and must be for `expectedPhone`
 * (when given) and recent.
 */
export class PhoneProofChecker {
  constructor(
    private readonly deps: { otp: OtpVerifier; firebase: PhoneIdentityVerifier | null; clock: Clock },
  ) {}

  get firebaseEnabled(): boolean {
    return this.deps.firebase !== null;
  }

  async check(
    proof: PhoneProof,
    opts: { expectedPhone?: string; otpTargetHash: (phone: string) => string; purpose: OtpPurpose },
  ): Promise<ProofResult> {
    if ('idToken' in proof) {
      if (!this.deps.firebase) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Phone sign-in with Firebase is not enabled');
      const verified = await this.deps.firebase.verify(proof.idToken);
      if (!verified) throw new DomainError(ErrorCode.OTP_INVALID, 'Phone verification failed. Try again.');
      if (this.deps.clock.now().getTime() - verified.authTime.getTime() > MAX_PROOF_AGE_MS) {
        throw new DomainError(ErrorCode.OTP_EXPIRED, 'Verification expired. Request a new code.');
      }
      const phone = normalizeIndianMobile(verified.phone);
      if (opts.expectedPhone && phone !== opts.expectedPhone) {
        throw new DomainError(ErrorCode.OTP_INVALID, 'That code was for a different number');
      }
      return { phone, consume: async () => undefined };
    }

    if (!opts.expectedPhone) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Phone number required');
    const challenge = await this.deps.otp.check(opts.otpTargetHash(opts.expectedPhone), opts.purpose, proof.code, opts.expectedPhone);
    return {
      phone: opts.expectedPhone,
      consume: async () => {
        if (challenge) await this.deps.otp.consume(challenge.id);
      },
    };
  }
}
