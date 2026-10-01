import {
  DomainError,
  normalizeAccountName,
  normalizeEmail,
  type Account,
  type AccountRepository,
  type Actor,
  type Clock,
  type CryptoService,
  type EmailProvider,
  type EventPublisher,
  type RateLimiter,
  type SessionRepository,
  type TrustedDeviceRepository,
  OTP_RULES,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { OtpVerifier } from '../auth/otp-verifier.js';

export interface MeView {
  phone: string;
  /** Null until set: the app asks for it right after the first sign-in. */
  name: string | null;
  /** YYYY-MM-DD; private. */
  dateOfBirth: string | null;
  gender: Account['gender'];
  email: string | null;
  emailVerified: boolean;
  createdAt: Date;
}

export interface SessionView {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  current: boolean;
}

export interface AccountDeps {
  accounts: AccountRepository;
  sessions: SessionRepository;
  /** Optional: remote logout also makes that device verify the mobile again. */
  trustedDevices?: TrustedDeviceRepository;
  otp: OtpVerifier;
  email: EmailProvider;
  crypto: CryptoService;
  limiter: RateLimiter;
  clock: Clock;
  events?: EventPublisher;
}

/** Use cases for the signed-in user's own account (`/me`). */
export class AccountService {
  constructor(private readonly deps: AccountDeps) {}

  async getMe(actor: Actor): Promise<MeView> {
    const account = await this.deps.accounts.findById(actor.accountId);
    if (!account) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in again');
    return {
      phone: account.phone,
      name: account.name,
      dateOfBirth: account.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      gender: account.gender,
      email: account.emailVerifiedAt ? account.email : null,
      emailVerified: Boolean(account.emailVerifiedAt),
      createdAt: account.createdAt,
    };
  }

  /** The person's own name. Private: never shown to the people they chat with. */
  async setName(actor: Actor, input: string): Promise<MeView> {
    await this.deps.accounts.setName(actor.accountId, normalizeAccountName(input));
    return this.getMe(actor);
  }

  async listSessions(actor: Actor): Promise<SessionView[]> {
    const sessions = await this.deps.sessions.listActive(actor.accountId, this.deps.clock.now());
    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      current: s.id === actor.sessionId,
    }));
  }

  async revokeSession(actor: Actor, sessionId: string): Promise<void> {
    const session = await this.deps.sessions.findById(sessionId);
    if (!session || session.accountId !== actor.accountId || session.revokedAt) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Device not found');
    }
    await this.deps.sessions.revoke(session.id, 'remote_logout', this.deps.clock.now());
    // A device logged out from elsewhere (lost phone…) must verify the mobile again on its next login.
    if (session.deviceHash) await this.deps.trustedDevices?.revoke(actor.accountId, session.deviceHash);
    await this.deps.events?.publish({ type: 'session.revoked', payload: { sessionId: session.id }, occurredAt: this.deps.clock.now() });
  }

  async startEmailVerification(actor: Actor, emailInput: string, ip: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    const targetHash = this.deps.crypto.hmac('target', email);
    const allowed = await this.deps.limiter.hit(`otp:send:${targetHash}`, OTP_RULES.sendLimit, OTP_RULES.sendWindowSeconds);
    if (!allowed) throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many codes requested. Try again later.');

    const code = await this.deps.otp.issue({
      channel: 'email',
      targetHash,
      purpose: 'email_verify',
      ipHash: this.deps.crypto.hmac('ip', ip),
    });
    await this.deps.email.sendOtp(email, code, 'verify');
  }

  async confirmEmail(actor: Actor, emailInput: string, code: string): Promise<void> {
    const email = normalizeEmail(emailInput);
    const challenge = await this.deps.otp.check(this.deps.crypto.hmac('target', email), 'email_verify', code);
    // Checked only after proving inbox ownership, so it can't be used to probe emails.
    if (await this.deps.accounts.isEmailTaken(email, actor.accountId)) {
      throw new DomainError(ErrorCode.CONFLICT, 'This email is linked to another account');
    }
    const now = this.deps.clock.now();
    await this.deps.accounts.setVerifiedEmail(actor.accountId, email, now);
    if (challenge) await this.deps.otp.consume(challenge.id);
  }
}
