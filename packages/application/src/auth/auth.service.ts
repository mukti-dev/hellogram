import {
  DomainError,
  OTP_RULES,
  isAccountRestricted,
  normalizeEmail,
  normalizeIndianMobile,
  type AccessTokenIssuer,
  type Account,
  type Actor,
  type AuthRepositories,
  type ClientInfo,
  type Clock,
  type CryptoService,
  type EmailProvider,
  type EventPublisher,
  type RateLimiter,
  type SmsProvider,
  type UnitOfWork,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { OtpVerifier } from './otp-verifier.js';
import type { PhoneProofChecker } from './phone-proof.js';

export interface AuthServiceConfig {
  consentVersion: string;
  sessionTtlDays: number;
}

export interface AuthDeps {
  repos: AuthRepositories;
  uow: UnitOfWork<AuthRepositories>;
  otp: OtpVerifier;
  sms: SmsProvider;
  email: EmailProvider;
  crypto: CryptoService;
  tokens: AccessTokenIssuer;
  limiter: RateLimiter;
  clock: Clock;
  /** Optional: lets the realtime layer drop sockets of revoked sessions. */
  events?: EventPublisher;
  /** Optional: Firebase Phone Auth (ID-token) sign-in. */
  proofs?: PhoneProofChecker;
}

export interface ConsentInput {
  ageConfirmed?: boolean | undefined;
  consentVersion?: string | undefined;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  /** Goes into the httpOnly cookie; never into a response body. */
  refreshToken: string;
  isNewAccount: boolean;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Use cases: phone OTP login/sign-up, email OTP login, refresh rotation, logout, token auth. */
export class AuthService {
  constructor(
    private readonly deps: AuthDeps,
    private readonly config: AuthServiceConfig,
  ) {}

  async sendPhoneOtp(phoneInput: string, client: ClientInfo): Promise<void> {
    const phone = normalizeIndianMobile(phoneInput);
    const targetHash = this.deps.crypto.hmac('target', phone);
    await this.enforceSendLimit(targetHash);
    const code = await this.deps.otp.issue({
      channel: 'sms',
      targetHash,
      purpose: 'login',
      ipHash: this.deps.crypto.hmac('ip', client.ip),
    });
    await this.deps.sms.sendOtp(phone, code);
  }

  async verifyPhoneOtp(input: { phone: string; code: string } & ConsentInput, client: ClientInfo): Promise<LoginResult> {
    const phone = normalizeIndianMobile(input.phone);
    const targetHash = this.deps.crypto.hmac('target', phone);
    const challenge = await this.deps.otp.check(targetHash, 'login', input.code);
    return this.completePhoneLogin(phone, challenge?.id ?? null, input, client);
  }

  /** Firebase Phone Auth: the device verified the SMS code with Google; we verify Google's token. */
  async verifyFirebaseLogin(input: { idToken: string } & ConsentInput, client: ClientInfo): Promise<LoginResult> {
    if (!this.deps.proofs?.firebaseEnabled) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Firebase phone sign-in is not enabled');
    }
    const { phone } = await this.deps.proofs.check(
      { idToken: input.idToken },
      { otpTargetHash: (p) => this.deps.crypto.hmac('target', p), purpose: 'login' },
    );
    return this.completePhoneLogin(phone, null, input, client);
  }

  private async completePhoneLogin(
    phone: string,
    challengeId: string | null,
    input: ConsentInput,
    client: ClientInfo,
  ): Promise<LoginResult> {
    const challenge = challengeId ? { id: challengeId } : null;
    const existing = await this.deps.repos.accounts.findByPhone(phone);
    if (!existing && (input.ageConfirmed !== true || input.consentVersion !== this.config.consentVersion)) {
      // Challenge is left unconsumed so the same code works after the user confirms.
      throw new DomainError(
        ErrorCode.AGE_CONFIRMATION_REQUIRED,
        'Confirm you are 18 or older and accept the Terms and Privacy Policy',
        { consentVersion: this.config.consentVersion },
      );
    }
    if (existing) this.assertNotRestricted(existing);

    const now = this.deps.clock.now();
    const ipHash = this.deps.crypto.hmac('ip', client.ip);

    return this.deps.uow.run(async (repos) => {
      if (challenge && !(await repos.otps.consume(challenge.id, now))) throw codeUsed();
      const account =
        existing ??
        (await repos.accounts.create({
          phone,
          ageConfirmedAt: now,
          consentVersion: this.config.consentVersion,
          ipHash,
        }));
      const tokens = await this.startSession(repos, account.id, client, ipHash);
      return { ...tokens, isNewAccount: !existing };
    });
  }

  /** Always succeeds from the caller's view, so it can't reveal which emails have accounts. */
  async sendEmailLoginOtp(emailInput: string, client: ClientInfo): Promise<void> {
    const email = normalizeEmail(emailInput);
    const targetHash = this.deps.crypto.hmac('target', email);
    await this.enforceSendLimit(targetHash);

    const account = await this.deps.repos.accounts.findByVerifiedEmail(email);
    if (!account || isAccountRestricted(account, this.deps.clock.now())) return;

    const code = await this.deps.otp.issue({
      channel: 'email',
      targetHash,
      purpose: 'email_login',
      ipHash: this.deps.crypto.hmac('ip', client.ip),
    });
    await this.deps.email.sendOtp(email, code, 'login');
  }

  async verifyEmailOtp(input: { email: string; code: string }, client: ClientInfo): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const targetHash = this.deps.crypto.hmac('target', email);
    const challenge = await this.deps.otp.check(targetHash, 'email_login', input.code);

    const account = await this.deps.repos.accounts.findByVerifiedEmail(email);
    if (!account) throw new DomainError(ErrorCode.OTP_INVALID, 'That code is incorrect');
    this.assertNotRestricted(account);

    const now = this.deps.clock.now();
    const ipHash = this.deps.crypto.hmac('ip', client.ip);
    return this.deps.uow.run(async (repos) => {
      if (challenge && !(await repos.otps.consume(challenge.id, now))) throw codeUsed();
      return { ...(await this.startSession(repos, account.id, client, ipHash)), isNewAccount: false };
    });
  }

  /** Rotates the refresh token. Re-using an old token revokes the whole session. */
  async refresh(refreshToken: string | undefined): Promise<Omit<LoginResult, 'isNewAccount'>> {
    if (!refreshToken) throw unauthenticated();
    const now = this.deps.clock.now();
    const record = await this.deps.repos.sessions.findRefreshToken(this.deps.crypto.hmac('refresh', refreshToken));
    if (!record) throw unauthenticated();

    const { session } = record;
    if (session.revokedAt || session.expiresAt <= now) throw unauthenticated();

    const account = await this.deps.repos.accounts.findById(session.accountId);
    if (!account || isAccountRestricted(account, now)) {
      await this.deps.repos.sessions.revoke(session.id, 'account_action', now);
      await this.revoked(session.id);
      throw new DomainError(ErrorCode.ACCOUNT_RESTRICTED, 'This account is restricted');
    }

    const firstUse = await this.deps.repos.sessions.markRefreshTokenUsed(record.id, now);
    if (!firstUse) {
      await this.deps.repos.sessions.revoke(session.id, 'reuse_detected', now);
      await this.revoked(session.id);
      throw unauthenticated();
    }

    const next = this.deps.crypto.randomToken();
    await this.deps.repos.sessions.addRefreshToken(session.id, this.deps.crypto.hmac('refresh', next));
    await this.deps.repos.sessions.touch(session.id, now);
    const access = await this.deps.tokens.issue({ accountId: session.accountId, sessionId: session.id });
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken: next };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const record = await this.deps.repos.sessions.findRefreshToken(this.deps.crypto.hmac('refresh', refreshToken));
    if (record && !record.session.revokedAt) {
      await this.deps.repos.sessions.revoke(record.sessionId, 'logout', this.deps.clock.now());
      await this.revoked(record.sessionId);
    }
  }

  /** For long-lived sockets: still a live session on a non-restricted account? */
  async isSessionActive(sessionId: string): Promise<boolean> {
    const now = this.deps.clock.now();
    const session = await this.deps.repos.sessions.findById(sessionId);
    if (!session || session.revokedAt || session.expiresAt <= now) return false;
    const account = await this.deps.repos.accounts.findById(session.accountId);
    return Boolean(account && !isAccountRestricted(account, now));
  }

  private revoked(sessionId: string) {
    return this.deps.events?.publish({ type: 'session.revoked', payload: { sessionId }, occurredAt: this.deps.clock.now() });
  }

  /** Resolves an access token to an actor. Checks the session so remote logout takes effect at once. */
  async authenticate(accessToken: string): Promise<Actor | null> {
    const claims = await this.deps.tokens.verify(accessToken);
    if (!claims) return null;
    const now = this.deps.clock.now();
    const session = await this.deps.repos.sessions.findById(claims.sessionId);
    if (!session || session.accountId !== claims.accountId || session.revokedAt || session.expiresAt <= now) {
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.deps.repos.sessions.touch(session.id, now);
    }
    return { accountId: session.accountId, sessionId: session.id };
  }

  private async startSession(repos: AuthRepositories, accountId: string, client: ClientInfo, ipHash: string) {
    const now = this.deps.clock.now();
    const session = await repos.sessions.create({
      accountId,
      deviceName: client.deviceName?.slice(0, 60) ?? null,
      userAgent: client.userAgent?.slice(0, 300) ?? null,
      ipHash,
      expiresAt: new Date(now.getTime() + this.config.sessionTtlDays * 24 * 60 * 60 * 1000),
    });
    const refreshToken = this.deps.crypto.randomToken();
    await repos.sessions.addRefreshToken(session.id, this.deps.crypto.hmac('refresh', refreshToken));
    const access = await this.deps.tokens.issue({ accountId, sessionId: session.id });
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken };
  }

  private async enforceSendLimit(targetHash: string): Promise<void> {
    const allowed = await this.deps.limiter.hit(
      `otp:send:${targetHash}`,
      OTP_RULES.sendLimit,
      OTP_RULES.sendWindowSeconds,
    );
    if (!allowed) {
      throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many codes requested. Try again in a few minutes.');
    }
  }

  private assertNotRestricted(account: Account): void {
    if (isAccountRestricted(account, this.deps.clock.now())) {
      throw new DomainError(ErrorCode.ACCOUNT_RESTRICTED, 'This account is restricted');
    }
  }
}

const codeUsed = () => new DomainError(ErrorCode.OTP_EXPIRED, 'This code has already been used. Request a new one.');
const unauthenticated = () => new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in again');
