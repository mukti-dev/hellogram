import type { Gender } from '@hellogram/shared';
import type { VaultAccess } from '../vault/vault.js';

export type AccountStatus = 'active' | 'suspended' | 'banned' | 'pending_deletion' | 'deleted';

export interface Account {
  id: string;
  phone: string;
  /** Private: only ever returned to the account itself. Null until asked at first sign-in. */
  name: string | null;
  dateOfBirth: Date | null;
  gender: Gender | null;
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
  /** HMAC of the device cookie, to forget the device when this session is logged out remotely. */
  deviceHash?: string | null;
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
export type OtpPurpose =
  | 'login'
  | 'signup'
  | 'device_login'
  | 'password_reset'
  | 'email_login'
  | 'email_verify'
  | 'pin_reset'
  | 'phone_change'
  | 'account_delete';

export interface OtpChallenge {
  id: string;
  channel: OtpChannel;
  targetHash: string;
  purpose: OtpPurpose;
  codeHash: string;
  /** Set when an outside service made the code and checks it (e.g. Message Central). */
  providerRef?: string | null;
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
  /** Locked chats and hidden spaces this device opened with X-Vault-Unlock tokens. */
  vault?: VaultAccess;
}

/** Request metadata used for sessions and abuse limits (IP is hashed before storage). */
export interface ClientInfo {
  ip: string;
  userAgent?: string | undefined;
  deviceName?: string | undefined;
}

export const isAccountRestricted = (account: Account, now: Date): boolean =>
  account.status === 'banned' ||
  account.status === 'pending_deletion' ||
  account.status === 'deleted' ||
  (account.status === 'suspended' && (!account.suspendedUntil || account.suspendedUntil > now));
