import {
  DomainError,
  OTP_RULES,
  assertStrongPassword,
  isAccountRestricted,
  normalizeAccountName,
  normalizeIndianMobile,
  parseAdultDateOfBirth,
  parseGender,
  type AccessTokenIssuer,
  type Account,
  type Actor,
  type AuthRepositories,
  type ClientInfo,
  type Clock,
  type CryptoService,
  type EphemeralStore,
  type EventPublisher,
  type PasswordHasher,
  type PendingDeviceLogin,
  type PendingSignup,
  type PhoneProof,
  type RateLimiter,
  type UnitOfWork,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { OtpVerifier } from './otp-verifier.js';
import type { PhoneProofChecker } from './phone-proof.js';

export interface AuthServiceConfig {
  consentVersion: string;
  sessionTtlDays: number;
  /** "otp": this server sends the codes. "firebase": the device does (Firebase Phone Auth). */
  phoneAuth?: 'otp' | 'firebase';
}

export interface AuthDeps {
  repos: AuthRepositories;
  uow: UnitOfWork<AuthRepositories>;
  otp: OtpVerifier;
  proofs: PhoneProofChecker;
  passwords: PasswordHasher;
  pendingSignups: EphemeralStore<PendingSignup>;
  deviceLogins: EphemeralStore<PendingDeviceLogin>;
  crypto: CryptoService;
  tokens: AccessTokenIssuer;
  limiter: RateLimiter;
  clock: Clock;
  /** Optional: lets the realtime layer drop sockets of revoked sessions. */
  events?: EventPublisher;
}

export interface SignupInput {
  name: string;
  phone: string;
  /** YYYY-MM-DD */
  dateOfBirth: string;
  gender: string;
  password: string;
  termsAccepted: boolean;
  consentVersion: string;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  /** Goes into the httpOnly cookie; never into a response body. */
  refreshToken: string;
  /** This browser's device id (httpOnly cookie): login here needs no OTP from now on. */
  deviceId: string;
}

export type PasswordLoginResult =
  | ({ status: 'ok' } & LoginResult)
  | { status: 'verify_device'; ticket: string };

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const SIGNUP_TTL_SECONDS = 15 * 60;
const DEVICE_LOGIN_TTL_SECONDS = 10 * 60;
/** Password guesses per mobile number per 15 minutes (on top of per-IP limits). */
const LOGIN_ATTEMPTS = 10;
const DEVICE_ID = /^[A-Za-z0-9_-]{32,64}$/;

const invalidCredentials = () =>
  new DomainError(ErrorCode.INVALID_CREDENTIALS, 'Mobile number or password is incorrect');

/**
 * Sign-up (name, mobile, date of birth, gender, password; 18+ only), verified by an OTP to the mobile.
 * Login is mobile + password; a device that hasn't verified the mobile before also needs an OTP, once.
 */
export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly deps: AuthDeps,
    private readonly config: AuthServiceConfig,
  ) {}

  private get serverSendsCodes() {
    return (this.config.phoneAuth ?? 'otp') === 'otp';
  }

  // ─── Sign-up ───

  /**
   * Checks the details, then sends a code to the mobile. Nothing is created yet: the details wait
   * (password already hashed) until the code is entered. Never says whether the number is taken.
   */
  async startSignup(input: SignupInput, client: ClientInfo): Promise<{ signupId: string }> {
    const now = this.deps.clock.now();
    const name = normalizeAccountName(input.name);
    const phone = normalizeIndianMobile(input.phone);
    const dateOfBirth = parseAdultDateOfBirth(input.dateOfBirth, now);
    const gender = parseGender(input.gender);
    assertStrongPassword(input.password, phone);
    if (!input.termsAccepted) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Accept the Terms of Service and Privacy Policy to continue');
    }
    if (input.consentVersion !== this.config.consentVersion) {
      throw new DomainError(ErrorCode.AGE_CONFIRMATION_REQUIRED, 'Our Terms have been updated. Reload the page and try again.', {
        consentVersion: this.config.consentVersion,
      });
    }

    const targetHash = this.deps.crypto.hmac('target', phone);
    await this.enforceSendLimit(targetHash);
    const signupId = await this.deps.pendingSignups.put(
      {
        name,
        phone,
        dateOfBirth: dateOfBirth.toISOString().slice(0, 10),
        gender,
        passwordHash: await this.deps.passwords.hash(input.password),
        consentVersion: input.consentVersion,
      },
      SIGNUP_TTL_SECONDS,
    );
    await this.sendCode(phone, targetHash, 'signup', client);
    return { signupId };
  }

  async resendSignupCode(signupId: string, client: ClientInfo): Promise<void> {
    const pending = await this.deps.pendingSignups.get(signupId);
    if (!pending) throw signupExpired();
    const targetHash = this.deps.crypto.hmac('target', pending.phone);
    await this.enforceSendLimit(targetHash);
    await this.sendCode(pending.phone, targetHash, 'signup', client);
  }

  /** The mobile is verified: create the account, trust this device and sign in. */
  async completeSignup(
    input: { signupId: string; proof: PhoneProof; deviceId?: string | undefined },
    client: ClientInfo,
  ): Promise<LoginResult> {
    const pending = await this.deps.pendingSignups.get(input.signupId);
    if (!pending) throw signupExpired();
    const verified = await this.deps.proofs.check(input.proof, {
      expectedPhone: pending.phone,
      otpTargetHash: (p) => this.deps.crypto.hmac('target', p),
      purpose: 'signup',
    });

    if (await this.deps.repos.accounts.findByPhone(pending.phone)) {
      // They proved they own the number, so it's safe to say it's already registered.
      await verified.consume().catch(() => undefined);
      await this.deps.pendingSignups.delete(input.signupId);
      throw new DomainError(ErrorCode.ACCOUNT_EXISTS, 'This mobile number already has an account. Log in instead.');
    }

    const now = this.deps.clock.now();
    const ipHash = this.deps.crypto.hmac('ip', client.ip);
    const result = await this.deps.uow.run(async (repos) => {
      await verified.consume();
      const account = await repos.accounts.create({
        phone: pending.phone,
        name: pending.name,
        passwordHash: pending.passwordHash,
        dateOfBirth: new Date(`${pending.dateOfBirth}T00:00:00Z`),
        gender: pending.gender,
        ageConfirmedAt: now,
        consentVersion: pending.consentVersion,
        ipHash,
      });
      return this.signIn(repos, account.id, client, ipHash, input.deviceId);
    });
    await this.deps.pendingSignups.delete(input.signupId);
    return result;
  }

  // ─── Login ───

  /**
   * Mobile + password. On a device that has verified this mobile before, that's it; otherwise an OTP
   * goes to the mobile — only after the password is right, so strangers can't trigger SMS or calls.
   */
  async login(
    input: { phone: string; password: string; deviceId?: string | undefined },
    client: ClientInfo,
  ): Promise<PasswordLoginResult> {
    let phone: string;
    try {
      phone = normalizeIndianMobile(input.phone);
    } catch {
      throw invalidCredentials();
    }
    const targetHash = this.deps.crypto.hmac('target', phone);
    if (!(await this.deps.limiter.hit(`login:${targetHash}`, LOGIN_ATTEMPTS, 15 * 60))) {
      throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many login attempts. Try again in 15 minutes, or reset your password.');
    }

    const account = await this.deps.repos.accounts.findByPhone(phone);
    const hash = account ? await this.deps.repos.accounts.findPasswordHash(account.id) : null;
    // Always run a full hash check, so a missing account takes as long as a wrong password.
    const ok = await this.deps.passwords.verify(hash ?? (await this.dummy()), input.password);
    if (!account || !hash || !ok) throw invalidCredentials();
    this.assertCanSignIn(account);

    const ipHash = this.deps.crypto.hmac('ip', client.ip);
    if (await this.isTrustedDevice(account.id, input.deviceId)) {
      const result = await this.deps.uow.run((repos) => this.signIn(repos, account.id, client, ipHash, input.deviceId));
      return { status: 'ok', ...result };
    }

    await this.enforceSendLimit(targetHash);
    await this.sendCode(phone, targetHash, 'device_login', client);
    const ticket = await this.deps.deviceLogins.put({ accountId: account.id, phone }, DEVICE_LOGIN_TTL_SECONDS);
    return { status: 'verify_device', ticket };
  }

  async resendDeviceCode(ticket: string, client: ClientInfo): Promise<void> {
    const pending = await this.deps.deviceLogins.get(ticket);
    if (!pending) throw loginExpired();
    const targetHash = this.deps.crypto.hmac('target', pending.phone);
    await this.enforceSendLimit(targetHash);
    await this.sendCode(pending.phone, targetHash, 'device_login', client);
  }

  /** The OTP for a new device: sign in and remember the device. */
  async verifyDevice(
    input: { ticket: string; proof: PhoneProof; deviceId?: string | undefined },
    client: ClientInfo,
  ): Promise<LoginResult> {
    const pending = await this.deps.deviceLogins.get(input.ticket);
    if (!pending) throw loginExpired();
    const verified = await this.deps.proofs.check(input.proof, {
      expectedPhone: pending.phone,
      otpTargetHash: (p) => this.deps.crypto.hmac('target', p),
      purpose: 'device_login',
    });
    const account = await this.deps.repos.accounts.findById(pending.accountId);
    // The number may have moved to another account (phone change) since the password check.
    if (!account || account.phone !== pending.phone) throw loginExpired();
    this.assertCanSignIn(account);

    const ipHash = this.deps.crypto.hmac('ip', client.ip);
    const result = await this.deps.uow.run(async (repos) => {
      await verified.consume();
      return this.signIn(repos, account.id, client, ipHash, input.deviceId, { trust: true });
    });
    await this.deps.deviceLogins.delete(input.ticket);
    return result;
  }

  // ─── Forgot password ───

  /** Always looks the same to the caller, so it can't be used to find out which numbers have accounts. */
  async forgotPassword(phoneInput: string, client: ClientInfo): Promise<void> {
    const phone = normalizeIndianMobile(phoneInput);
    const targetHash = this.deps.crypto.hmac('target', phone);
    await this.enforceSendLimit(targetHash);
    const account = await this.deps.repos.accounts.findByPhone(phone);
    if (!account || !this.canSignIn(account)) return;
    await this.sendCode(phone, targetHash, 'password_reset', client);
  }

  /** New password after an OTP: every other device is signed out and must verify again. */
  async resetPassword(
    input: { phone: string; proof: PhoneProof; password: string; deviceId?: string | undefined },
    client: ClientInfo,
  ): Promise<LoginResult> {
    const phone = normalizeIndianMobile(input.phone);
    assertStrongPassword(input.password, phone);
    const verified = await this.deps.proofs.check(input.proof, {
      expectedPhone: phone,
      otpTargetHash: (p) => this.deps.crypto.hmac('target', p),
      purpose: 'password_reset',
    });
    const account = await this.deps.repos.accounts.findByPhone(phone);
    if (!account) throw new DomainError(ErrorCode.NOT_FOUND, 'No account uses this mobile number. Sign up instead.');
    this.assertCanSignIn(account);

    const now = this.deps.clock.now();
    const ipHash = this.deps.crypto.hmac('ip', client.ip);
    const passwordHash = await this.deps.passwords.hash(input.password);
    const previous = await this.deps.repos.sessions.listActive(account.id, now);
    const result = await this.deps.uow.run(async (repos) => {
      await verified.consume();
      await repos.accounts.setPasswordHash(account.id, passwordHash);
      for (const session of previous) await repos.sessions.revoke(session.id, 'password_reset', now);
      await repos.trustedDevices.revokeAll(account.id);
      return this.signIn(repos, account.id, client, ipHash, input.deviceId, { trust: true });
    });
    for (const session of previous) await this.revoked(session.id);
    return result;
  }

  /** Rotates the refresh token. Re-using an old token revokes the whole session. */
  async refresh(refreshToken: string | undefined): Promise<Omit<LoginResult, 'deviceId'>> {
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

  /** Starts a session; optionally (after an OTP) remembers this device for the account. */
  private async signIn(
    repos: AuthRepositories,
    accountId: string,
    client: ClientInfo,
    ipHash: string,
    deviceIdInput: string | undefined,
    options: { trust?: boolean } = { trust: true },
  ): Promise<LoginResult> {
    const now = this.deps.clock.now();
    const deviceId = deviceIdInput && DEVICE_ID.test(deviceIdInput) ? deviceIdInput : this.deps.crypto.randomToken(32);
    const deviceHash = this.deps.crypto.hmac('device', deviceId);
    if (options.trust !== false) await repos.trustedDevices.trust(accountId, deviceHash, now);
    // Signing in within 30 days of asking to delete the account keeps it.
    await repos.accounts.cancelDeletion(accountId);
    const session = await repos.sessions.create({
      accountId,
      deviceName: client.deviceName?.slice(0, 60) ?? null,
      userAgent: client.userAgent?.slice(0, 300) ?? null,
      ipHash,
      deviceHash,
      expiresAt: new Date(now.getTime() + this.config.sessionTtlDays * 24 * 60 * 60 * 1000),
    });
    const refreshToken = this.deps.crypto.randomToken();
    await repos.sessions.addRefreshToken(session.id, this.deps.crypto.hmac('refresh', refreshToken));
    const access = await this.deps.tokens.issue({ accountId, sessionId: session.id });
    return { accessToken: access.token, expiresIn: access.expiresIn, refreshToken, deviceId };
  }

  private async isTrustedDevice(accountId: string, deviceId: string | undefined): Promise<boolean> {
    if (!deviceId || !DEVICE_ID.test(deviceId)) return false;
    return this.deps.repos.trustedDevices.isTrusted(accountId, this.deps.crypto.hmac('device', deviceId));
  }

  /** Our OTP (SMS, voice call or a hosted service). In Firebase mode the device sends it instead. */
  private async sendCode(
    phone: string,
    targetHash: string,
    purpose: 'signup' | 'device_login' | 'password_reset',
    client: ClientInfo,
  ): Promise<void> {
    if (!this.serverSendsCodes) return;
    await this.deps.otp.sendSms(phone, { targetHash, purpose, ipHash: this.deps.crypto.hmac('ip', client.ip) });
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.deps.passwords.hash(this.deps.crypto.randomToken());
    return this.dummyHash;
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

  /** A pending deletion doesn't stop a sign-in: signing in is how it is undone. */
  private canSignIn(account: Account): boolean {
    return account.status === 'pending_deletion' || !isAccountRestricted(account, this.deps.clock.now());
  }

  private assertCanSignIn(account: Account): void {
    if (!this.canSignIn(account)) {
      throw new DomainError(ErrorCode.ACCOUNT_RESTRICTED, 'This account is restricted');
    }
  }
}

const unauthenticated = () => new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in again');
const signupExpired = () => new DomainError(ErrorCode.OTP_EXPIRED, 'Sign-up timed out. Please start again.');
const loginExpired = () => new DomainError(ErrorCode.OTP_EXPIRED, 'This login timed out. Please log in again.');
