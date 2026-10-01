import type {
  Account,
  OtpChallenge,
  OtpChannel,
  OtpPurpose,
  RefreshTokenRecord,
  Session,
} from './entities.js';

export interface AccountRepository {
  findById(id: string): Promise<Account | null>;
  findByPhone(phone: string): Promise<Account | null>;
  findByVerifiedEmail(email: string): Promise<Account | null>;
  create(input: { phone: string; ageConfirmedAt: Date; consentVersion: string; ipHash: string }): Promise<Account>;
  setVerifiedEmail(accountId: string, email: string, verifiedAt: Date): Promise<void>;
  isEmailTaken(email: string, exceptAccountId: string): Promise<boolean>;
}

export interface SessionRepository {
  create(input: {
    accountId: string;
    deviceName: string | null;
    userAgent: string | null;
    ipHash: string;
    expiresAt: Date;
  }): Promise<Session>;
  findById(id: string): Promise<Session | null>;
  listActive(accountId: string, now: Date): Promise<Session[]>;
  touch(sessionId: string, at: Date): Promise<void>;
  revoke(sessionId: string, reason: string, at: Date): Promise<void>;
  addRefreshToken(sessionId: string, tokenHash: string): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Atomically marks a token used. Returns false if it was already used (reuse). */
  markRefreshTokenUsed(tokenId: string, at: Date): Promise<boolean>;
}

export interface OtpChallengeRepository {
  create(input: {
    channel: OtpChannel;
    targetHash: string;
    purpose: OtpPurpose;
    codeHash: string;
    expiresAt: Date;
    ipHash: string;
  }): Promise<void>;
  findLatestOpen(targetHash: string, purpose: OtpPurpose, now: Date): Promise<OtpChallenge | null>;
  /** Atomically takes one attempt; false when the limit is already used up (parallel-safe). */
  reserveAttempt(id: string, maxAttempts: number): Promise<boolean>;
  /** Single use: false if it was already consumed (e.g. two concurrent verifies). */
  consume(id: string, at: Date): Promise<boolean>;
}

export interface AuthRepositories {
  accounts: AccountRepository;
  sessions: SessionRepository;
  otps: OtpChallengeRepository;
}

export type SmsNotice = 'phone_change_requested';

export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
  /** Transactional notices (each needs its own DLT template in production). */
  sendNotice(phone: string, notice: SmsNotice): Promise<void>;
}

export interface EmailProvider {
  sendOtp(email: string, code: string, purpose: 'login' | 'verify'): Promise<void>;
}

/** Cryptographic helpers, implemented with node:crypto in infrastructure. */
export interface CryptoService {
  /** Keyed hash for lookups (targets, IPs, refresh tokens, OTP codes). */
  hmac(purpose: 'target' | 'ip' | 'refresh' | 'otp', value: string): string;
  randomToken(bytes?: number): string;
  randomDigits(length: number): string;
  /** Uniform random integer in [0, max). */
  randomInt(max: number): number;
  safeEqual(a: string, b: string): boolean;
}

export interface AccessTokenIssuer {
  issue(claims: { accountId: string; sessionId: string }): Promise<{ token: string; expiresIn: number }>;
  verify(token: string): Promise<{ accountId: string; sessionId: string } | null>;
}

/** Counter-based limiter (Redis). Returns false when the limit is exceeded. */
export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

/** Object storage for avatars (S3 in production, local disk in development). */
export interface StorageProvider {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

export interface QrCodeRenderer {
  svg(text: string): Promise<string>;
}

/** A verified phone number from an external identity provider (Firebase Phone Auth). */
export interface VerifiedPhone {
  /** E.164, e.g. +919876543210 */
  phone: string;
  /** When the user actually completed the SMS verification. */
  authTime: Date;
}

export interface PhoneIdentityVerifier {
  /** Returns null for invalid, expired or non-phone tokens. */
  verify(idToken: string): Promise<VerifiedPhone | null>;
}

/** Proof that the user controls a phone number: our own OTP, or a Firebase ID token. */
export type PhoneProof = { code: string } | { idToken: string };
