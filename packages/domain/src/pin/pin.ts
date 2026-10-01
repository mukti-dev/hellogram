import { ErrorCode, LIMITS } from '@hellogram/shared';
import { DomainError } from '../errors/domain-error.js';

export const PIN_RULES = {
  attemptsBeforeLock: 5,
  baseLockMs: 15 * 60 * 1000,
  maxLockMs: 24 * 60 * 60 * 1000,
  unlockTtlSeconds: 5 * 60,
} as const;

export function assertValidPin(pin: string): void {
  if (!new RegExp(`^\\d{${LIMITS.PIN_LENGTH}}$`).test(pin)) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, 'PIN must be 4 digits');
  }
}

export interface PinState {
  pinFailedCount: number;
  pinLockLevel: number;
  pinLockedUntil: Date | null;
}

export function assertNotLockedOut(state: PinState, now: Date): void {
  if (state.pinLockedUntil && state.pinLockedUntil > now) {
    throw new DomainError(ErrorCode.PIN_LOCKED_OUT, 'Too many wrong PINs. Try again later.', {
      retryAt: state.pinLockedUntil.toISOString(),
    });
  }
}

/**
 * Rule 26: 5 wrong PINs → 15 minutes. After a lockout, every further failure
 * locks again for double the previous time, up to 24 hours. Success resets.
 */
export function afterFailedPin(state: PinState, now: Date): PinState {
  const failed = state.pinFailedCount + 1;
  const shouldLock = state.pinLockLevel > 0 || failed >= PIN_RULES.attemptsBeforeLock;
  if (!shouldLock) return { ...state, pinFailedCount: failed, pinLockedUntil: null };
  const duration = Math.min(PIN_RULES.baseLockMs * 2 ** state.pinLockLevel, PIN_RULES.maxLockMs);
  return {
    pinFailedCount: 0,
    pinLockLevel: state.pinLockLevel + 1,
    pinLockedUntil: new Date(now.getTime() + duration),
  };
}

/**
 * Parallel-safe variant: the attempt was already counted atomically
 * (`reservedFailedCount` includes this one). Returns the lock to apply, if any.
 */
export function lockAfterReservedFailure(reservedFailedCount: number, lockLevel: number, now: Date): PinState | null {
  if (lockLevel === 0 && reservedFailedCount < PIN_RULES.attemptsBeforeLock) return null;
  const duration = Math.min(PIN_RULES.baseLockMs * 2 ** lockLevel, PIN_RULES.maxLockMs);
  return { pinFailedCount: 0, pinLockLevel: lockLevel + 1, pinLockedUntil: new Date(now.getTime() + duration) };
}

export const PIN_RESET: PinState = { pinFailedCount: 0, pinLockLevel: 0, pinLockedUntil: null };

export interface PinHasher {
  hash(pin: string): Promise<string>;
  verify(hash: string, pin: string): Promise<boolean>;
}

/** Device-scoped, sliding unlock tokens (rule 25), kept in Redis. */
export interface UnlockTokenStore {
  issue(sessionId: string, personaId: string, ttlSeconds: number): Promise<string>;
  /** Returns the persona id if valid for this session, extending its TTL. */
  verify(sessionId: string, token: string, ttlSeconds: number): Promise<string | null>;
  revokeAll(personaId: string): Promise<void>;
}

export interface PinRepository {
  getPinState(personaId: string): Promise<(PinState & { pinHash: string | null; accountId: string }) | null>;
  setPinHash(personaId: string, hash: string | null): Promise<void>;
  setPinState(personaId: string, state: PinState): Promise<void>;
  /**
   * Atomically counts one attempt unless locked out. Returns the state *after*
   * counting, or null when currently locked (parallel guesses can't skip the lock).
   */
  reserveAttempt(personaId: string, now: Date): Promise<{ pinHash: string; pinFailedCount: number; pinLockLevel: number } | null>;
  /** Rule 28: forgot-PIN clears this persona's side of every chat. */
  clearAllHistory(personaId: string, at: Date): Promise<void>;
}
