import type { VaultOpenDuration, VaultState } from '@hellogram/shared';
import type { PinState } from '../pin/pin.js';

export type { VaultState };

/**
 * Chat vault: one account-wide chat lock PIN for locked chats, and any number of hide PINs —
 * each hide PIN is its own space, showing only the chats hidden with it.
 */
export const VAULT_RULES = {
  /** A hide PIN is checked against every space, so keep the number bounded. */
  maxSpaces: 10,
  /** "Immediately" still needs a server lifetime; the app drops the token when the user leaves. */
  immediateTtlSeconds: 60 * 60,
} as const;

export const vaultTtlSeconds = (duration: VaultOpenDuration): number => duration || VAULT_RULES.immediateTtlSeconds;

/** What this device has opened with `X-Vault-Unlock` tokens. */
export interface VaultAccess {
  /** Locked chats (conversation ids). */
  chats: ReadonlySet<string>;
  /** Hidden spaces (space ids). */
  spaces: ReadonlySet<string>;
}

export const NO_VAULT_ACCESS: VaultAccess = { chats: new Set(), spaces: new Set() };

export interface VaultPins {
  lockPinHash: string | null;
  lock: PinState;
  hide: PinState;
}

export interface VaultSpace {
  id: string;
  pinHash: string;
}

export interface VaultRepository {
  getPins(accountId: string): Promise<VaultPins>;
  setLockPinHash(accountId: string, hash: string): Promise<void>;
  /** Counts one attempt atomically unless locked out; null while locked out (parallel guesses can't skip the lock). */
  reserveAttempt(accountId: string, which: 'lock' | 'hide', now: Date): Promise<{ failedCount: number; lockLevel: number } | null>;
  setPinState(accountId: string, which: 'lock' | 'hide', state: PinState): Promise<void>;
  listSpaces(accountId: string): Promise<VaultSpace[]>;
  createSpace(accountId: string, pinHash: string): Promise<VaultSpace>;
  /** Moves the member row; `spaceId` only for hidden. */
  setState(conversationId: string, personaId: string, state: VaultState | null, spaceId: string | null): Promise<void>;
  /** Archived and locked chats across these personas (hidden never counted). */
  counts(personaIds: string[]): Promise<{ archived: number; locked: number }>;
  /** Forgot hide PIN: every hidden chat goes back to the inbox and the spaces are deleted. */
  unhideAll(accountId: string): Promise<void>;
}

/** Device-scoped vault tokens with a fixed lifetime, kept in Redis. Only a hash is stored. */
export interface VaultTokenStore {
  issue(accountId: string, sessionId: string, subject: VaultSubject, ttlSeconds: number): Promise<string>;
  /** The subject, if the token is valid for this account and session. */
  verify(accountId: string, sessionId: string, token: string): Promise<VaultSubject | null>;
  revokeAll(accountId: string, kind: VaultSubject['kind']): Promise<void>;
}

export type VaultSubject = { kind: 'chat'; id: string } | { kind: 'space'; id: string };
