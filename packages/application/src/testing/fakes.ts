import { createHash, randomUUID } from 'node:crypto';
import type {
  AccessTokenIssuer,
  Account,
  EphemeralStore,
  PasswordHasher,
  TrustedDeviceRepository,
  AccountRepository,
  AuthRepositories,
  Clock,
  CreatePersonaInput,
  CryptoService,
  EmailProvider,
  OtpChallenge,
  OtpChallengeRepository,
  PauseReason,
  Persona,
  PersonaRepository,
  PersonaSettingsPatch,
  QrCodeRenderer,
  RateLimiter,
  RefreshTokenRecord,
  Session,
  SessionRepository,
  SmsProvider,
  StorageProvider,
  UnitOfWork,
} from '@hellogram/domain';

/** In-memory fakes for service unit tests. Integration tests cover the real Prisma/Redis adapters. */
export class FakeClock implements Clock {
  constructor(public current = new Date('2026-09-28T10:00:00Z')) {}
  now = () => new Date(this.current);
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class FakeAccounts implements AccountRepository {
  rows: (Account & { consentVersion: string })[] = [];
  findById = async (id: string) => this.rows.find((a) => a.id === id) ?? null;
  findByPhone = async (phone: string) => this.rows.find((a) => a.phone === phone) ?? null;
  findByVerifiedEmail = async (email: string) =>
    this.rows.find((a) => a.email === email && a.emailVerifiedAt) ?? null;
  passwords = new Map<string, string>();
  create = async (input: {
    phone: string;
    name?: string;
    passwordHash?: string;
    dateOfBirth?: Date;
    gender?: Account['gender'];
    ageConfirmedAt: Date;
    consentVersion: string;
  }) => {
    const account = {
      id: randomUUID(),
      phone: input.phone,
      name: input.name ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      gender: input.gender ?? null,
      email: null,
      emailVerifiedAt: null,
      status: 'active' as const,
      suspendedUntil: null,
      createdAt: input.ageConfirmedAt,
      consentVersion: input.consentVersion,
    };
    this.rows.push(account);
    if (input.passwordHash) this.passwords.set(account.id, input.passwordHash);
    return account;
  };
  findPasswordHash = async (accountId: string) => this.passwords.get(accountId) ?? null;
  setPasswordHash = async (accountId: string, hash: string) => void this.passwords.set(accountId, hash);
  setVerifiedEmail = async (accountId: string, email: string, at: Date) => {
    const a = this.rows.find((r) => r.id === accountId);
    if (a) Object.assign(a, { email, emailVerifiedAt: at });
  };
  setName = async (accountId: string, name: string) => {
    const a = this.rows.find((r) => r.id === accountId);
    if (a) a.name = name;
  };
  isEmailTaken = async (email: string, exceptAccountId: string) =>
    this.rows.some((a) => a.email === email && a.id !== exceptAccountId);
}

export class FakeSessions implements SessionRepository {
  sessions: (Session & { revokeReason?: string })[] = [];
  tokens: { id: string; sessionId: string; tokenHash: string; usedAt: Date | null }[] = [];
  create = async (input: {
    accountId: string;
    deviceName: string | null;
    userAgent: string | null;
    deviceHash?: string | null;
    expiresAt: Date;
  }) => {
    const session: Session = {
      id: randomUUID(),
      accountId: input.accountId,
      deviceName: input.deviceName,
      userAgent: input.userAgent,
      deviceHash: input.deviceHash ?? null,
      createdAt: new Date(),
      lastSeenAt: new Date(0),
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.sessions.push(session);
    return session;
  };
  findById = async (id: string) => this.sessions.find((s) => s.id === id) ?? null;
  listActive = async (accountId: string, now: Date) =>
    this.sessions.filter((s) => s.accountId === accountId && !s.revokedAt && s.expiresAt > now);
  touch = async (id: string, at: Date) => {
    const s = this.sessions.find((r) => r.id === id);
    if (s) s.lastSeenAt = at;
  };
  revoke = async (id: string, reason: string, at: Date) => {
    const s = this.sessions.find((r) => r.id === id);
    if (s) Object.assign(s, { revokedAt: at, revokeReason: reason });
  };
  addRefreshToken = async (sessionId: string, tokenHash: string) => {
    this.tokens.push({ id: randomUUID(), sessionId, tokenHash, usedAt: null });
  };
  findRefreshToken = async (tokenHash: string): Promise<RefreshTokenRecord | null> => {
    const t = this.tokens.find((r) => r.tokenHash === tokenHash);
    const session = t && this.sessions.find((s) => s.id === t.sessionId);
    return t && session ? { id: t.id, sessionId: t.sessionId, usedAt: t.usedAt, session } : null;
  };
  markRefreshTokenUsed = async (id: string, at: Date) => {
    const t = this.tokens.find((r) => r.id === id);
    if (!t || t.usedAt) return false;
    t.usedAt = at;
    return true;
  };
}

export class FakeOtps implements OtpChallengeRepository {
  rows: OtpChallenge[] = [];
  create = async (input: Omit<OtpChallenge, 'id' | 'attempts' | 'consumedAt'>) => {
    this.rows.push({ ...input, id: randomUUID(), attempts: 0, consumedAt: null });
  };
  findLatestOpen = async (targetHash: string, purpose: string, now: Date) =>
    [...this.rows].reverse().find(
      (r) => r.targetHash === targetHash && r.purpose === purpose && !r.consumedAt && r.expiresAt > now,
    ) ?? null;
  reserveAttempt = async (id: string, max: number) => {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.attempts >= max || r.consumedAt) return false;
    r.attempts += 1;
    return true;
  };
  consume = async (id: string, at: Date) => {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.consumedAt) return false;
    r.consumedAt = at;
    return true;
  };
}

export const fakeCrypto: CryptoService = {
  hmac: (purpose, value) => createHash('sha256').update(`${purpose}:${value}`).digest('hex'),
  randomToken: () => randomUUID(),
  randomDigits: () => '123456',
  randomInt: (max) => Math.floor(Math.random() * max),
  safeEqual: (a, b) => a === b,
};

export class FakeTokens implements AccessTokenIssuer {
  issue = async (claims: { accountId: string; sessionId: string }) => ({
    token: `tok:${claims.accountId}:${claims.sessionId}`,
    expiresIn: 900,
  });
  verify = async (token: string) => {
    const [prefix, accountId, sessionId] = token.split(':');
    return prefix === 'tok' && accountId && sessionId ? { accountId, sessionId } : null;
  };
}

export class FakeLimiter implements RateLimiter {
  counts = new Map<string, number>();
  hit = async (key: string, limit: number) => {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next <= limit;
  };
}

export class FakeSms implements SmsProvider {
  sent: { phone: string; code: string }[] = [];
  sendOtp = async (phone: string, code: string) => void this.sent.push({ phone, code });
  notices: { phone: string; notice: string }[] = [];
  sendNotice = async (phone: string, notice: string) => void this.notices.push({ phone, notice });
}

export class FakeEmail implements EmailProvider {
  sent: { email: string; code: string; purpose: string }[] = [];
  sendOtp = async (email: string, code: string, purpose: 'login' | 'verify') =>
    void this.sent.push({ email, code, purpose });
}

export class FakeTrustedDevices implements TrustedDeviceRepository {
  rows: { accountId: string; deviceHash: string }[] = [];
  isTrusted = async (accountId: string, deviceHash: string) =>
    this.rows.some((r) => r.accountId === accountId && r.deviceHash === deviceHash);
  trust = async (accountId: string, deviceHash: string) => {
    if (!(await this.isTrusted(accountId, deviceHash))) this.rows.push({ accountId, deviceHash });
  };
  revoke = async (accountId: string, deviceHash: string) => {
    this.rows = this.rows.filter((r) => !(r.accountId === accountId && r.deviceHash === deviceHash));
  };
  revokeAll = async (accountId: string) => {
    this.rows = this.rows.filter((r) => r.accountId !== accountId);
  };
}

export class FakeEphemeralStore<T> implements EphemeralStore<T> {
  values = new Map<string, T>();
  put = async (value: T) => {
    const id = randomUUID().replace(/-/g, '');
    this.values.set(id, value);
    return id;
  };
  get = async (id: string) => this.values.get(id) ?? null;
  delete = async (id: string) => void this.values.delete(id);
}

/** Readable stand-in for argon2 (tests only). */
export const fakePasswords: PasswordHasher = {
  hash: async (password) => `hashed:${password}`,
  verify: async (hash, password) => hash === `hashed:${password}`,
};

export const passthroughUow = (repos: AuthRepositories): UnitOfWork<AuthRepositories> => ({
  run: (work) => work(repos),
});

export class FakePersonas implements PersonaRepository {
  rows: Persona[] = [];
  retiredCodes = new Set<string>();
  findById = async (id: string) => this.rows.find((p) => p.id === id) ?? null;
  findByCode = async (code: string) => this.rows.find((p) => p.code === code) ?? null;
  listByAccount = async (accountId: string) => this.rows.filter((p) => p.accountId === accountId && p.status !== 'retired');
  countCreatedSince = async (accountId: string, since: Date) =>
    this.rows.filter((p) => p.accountId === accountId && p.createdAt >= since).length;
  codeTaken = async (code: string) => this.rows.some((p) => p.code === code) || this.retiredCodes.has(code);
  create = async (input: CreatePersonaInput) => {
    const persona: Persona = {
      ...input,
      id: randomUUID(),
      avatarKey: null,
      status: 'active',
      pauseReason: null,
      acceptRequests: true,
      readReceipts: true,
      dndUntil: null,
      defaultRetention: 'd30',
      hasPin: false,
      createdAt: new Date(),
      retiredAt: null,
    };
    this.rows.push(persona);
    return persona;
  };
  update = async (id: string, patch: PersonaSettingsPatch) => {
    const p = this.rows.find((r) => r.id === id)!;
    Object.assign(p, patch);
    return p;
  };
  setStatus = async (id: string, status: 'active' | 'paused', pauseReason: PauseReason | null) => {
    const p = this.rows.find((r) => r.id === id)!;
    Object.assign(p, { status, pauseReason });
    return p;
  };
  retire = async (id: string, at: Date) => {
    const p = this.rows.find((r) => r.id === id)!;
    Object.assign(p, { status: 'retired', retiredAt: at });
    this.retiredCodes.add(p.code);
  };
  markPaid = async (id: string, isPaid: boolean) => {
    const p = this.rows.find((r) => r.id === id)!;
    p.isPaid = isPaid;
  };
}

export const fakeStorage: StorageProvider = {
  put: async () => {},
  delete: async () => {},
  publicUrl: (key) => `/media/${key}`,
};

export const fakeQr: QrCodeRenderer = { svg: async (text) => `<svg data-text="${text}"/>` };
