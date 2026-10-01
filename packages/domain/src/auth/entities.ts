export type AccountStatus = 'active' | 'suspended' | 'banned' | 'deleted';

export interface Account {
  id: string;
  phone: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  status: AccountStatus;
  suspendedUntil: Date | null;
  createdAt: Date;
}

export interface Session {
  id: string;
  accountId: string;
  deviceName: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface RefreshTokenRecord {
  id: string;
  sessionId: string;
  usedAt: Date | null;
  session: Session;
}

export type OtpChannel = 'sms' | 'email';
export type OtpPurpose = 'login' | 'email_login' | 'email_verify' | 'pin_reset' | 'phone_change' | 'account_delete';

export interface OtpChallenge {
  id: string;
  channel: OtpChannel;
  targetHash: string;
  purpose: OtpPurpose;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

/** Who is making the request — built by the API auth plugin, passed to services. */
export interface Actor {
  accountId: string;
  sessionId: string;
  /** Locked personas this device unlocked with a valid X-Persona-Unlock token (rule 25). */
  unlockedPersonaIds?: ReadonlySet<string>;
}

/** Request metadata used for sessions and abuse limits (IP is hashed before storage). */
export interface ClientInfo {
  ip: string;
  userAgent?: string | undefined;
  deviceName?: string | undefined;
}

export const isAccountRestricted = (account: Account, now: Date): boolean =>
  account.status === 'banned' ||
  account.status === 'deleted' ||
  (account.status === 'suspended' && (!account.suspendedUntil || account.suspendedUntil > now));
