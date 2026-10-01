import {
  DomainError,
  OTP_RULES,
  PIN_RESET,
  PIN_RULES,
  lockAfterReservedFailure,
  assertNotLockedOut,
  assertValidPin,
  type AccountRepository,
  type Actor,
  type Clock,
  type CryptoService,
  type EventPublisher,
  type Persona,
  type PhoneProof,
  type PersonaRepository,
  type PinHasher,
  type PinRepository,
  type RateLimiter,
  type SmsProvider,
  type UnlockTokenStore,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { OtpVerifier } from '../auth/otp-verifier.js';
import type { PhoneProofChecker } from '../auth/phone-proof.js';

export interface PinDeps {
  personas: PersonaRepository;
  pins: PinRepository;
  accounts: AccountRepository;
  hasher: PinHasher;
  tokens: UnlockTokenStore;
  otp: OtpVerifier;
  proofs: PhoneProofChecker;
  sms: SmsProvider;
  crypto: CryptoService;
  limiter: RateLimiter;
  events: EventPublisher;
  clock: Clock;
}

export interface UnlockResult {
  unlockToken: string;
  expiresIn: number;
}

/** Number lock (rules 24–28). */
export class PinService {
  constructor(private readonly deps: PinDeps) {}

  /** Validates X-Persona-Unlock tokens for this device; returns unlocked persona ids. */
  async resolveUnlocked(sessionId: string, tokens: string[]): Promise<Set<string>> {
    const unlocked = new Set<string>();
    for (const token of tokens.slice(0, 5)) {
      const personaId = await this.deps.tokens.verify(sessionId, token, PIN_RULES.unlockTtlSeconds);
      if (personaId) unlocked.add(personaId);
    }
    return unlocked;
  }

  /** Set or change. Changing needs the current PIN (or this device already unlocked it). */
  async setPin(actor: Actor, personaId: string, pin: string, currentPin?: string): Promise<UnlockResult> {
    assertValidPin(pin);
    const persona = await this.own(actor, personaId);
    if (persona.hasPin && !actor.unlockedPersonaIds?.has(persona.id)) {
      if (!currentPin) throw new DomainError(ErrorCode.PIN_INVALID, 'Enter your current PIN');
      await this.checkPin(persona.id, currentPin);
    }
    await this.deps.pins.setPinHash(persona.id, await this.deps.hasher.hash(pin));
    await this.deps.tokens.revokeAll(persona.id);
    await this.changed(persona);
    return this.issue(actor, persona.id);
  }

  async removePin(actor: Actor, personaId: string, pin: string): Promise<void> {
    const persona = await this.own(actor, personaId);
    if (!persona.hasPin) return;
    await this.checkPin(persona.id, pin);
    await this.deps.pins.setPinHash(persona.id, null);
    await this.deps.tokens.revokeAll(persona.id);
    await this.changed(persona);
  }

  async unlock(actor: Actor, personaId: string, pin: string): Promise<UnlockResult> {
    const persona = await this.own(actor, personaId);
    if (!persona.hasPin) return this.issue(actor, persona.id);
    await this.checkPin(persona.id, pin);
    return this.issue(actor, persona.id);
  }

  /** Forgot PIN, step 1: OTP to the account's own phone. */
  async sendResetOtp(actor: Actor, personaId: string, ip: string): Promise<void> {
    const persona = await this.own(actor, personaId);
    const account = await this.deps.accounts.findById(actor.accountId);
    if (!account) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in again');
    const targetHash = this.resetTarget(account.phone, persona.id);
    const allowed = await this.deps.limiter.hit(`otp:send:${targetHash}`, OTP_RULES.sendLimit, OTP_RULES.sendWindowSeconds);
    if (!allowed) throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many codes requested. Try again later.');
    await this.deps.otp.sendSms(account.phone, { targetHash, purpose: 'pin_reset', ipHash: this.deps.crypto.hmac('ip', ip) });
  }

  /**
   * Forgot PIN, step 2 (rule 28): OTP → clear this number's side of every chat → new PIN.
   * The number, its contacts and the other side's history are untouched.
   */
  async resetPin(actor: Actor, personaId: string, proof: PhoneProof, newPin: string): Promise<UnlockResult> {
    assertValidPin(newPin);
    const persona = await this.own(actor, personaId);
    const account = await this.deps.accounts.findById(actor.accountId);
    if (!account) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in again');
    // Our own OTP, or a fresh Firebase verification of *this account's* phone.
    const verified = await this.deps.proofs.check(proof, {
      expectedPhone: account.phone,
      otpTargetHash: (phone) => this.resetTarget(phone, persona.id),
      purpose: 'pin_reset',
    });
    await verified.consume();

    await this.deps.pins.clearAllHistory(persona.id, this.deps.clock.now());
    await this.deps.pins.setPinHash(persona.id, await this.deps.hasher.hash(newPin));
    await this.deps.tokens.revokeAll(persona.id);
    await this.changed(persona);
    return this.issue(actor, persona.id);
  }

  private resetTarget(phone: string, personaId: string) {
    return this.deps.crypto.hmac('target', `pin_reset:${personaId}:${phone}`);
  }

  private async checkPin(personaId: string, pin: string): Promise<void> {
    const current = await this.deps.pins.getPinState(personaId);
    if (!current?.pinHash) return;
    const now = this.deps.clock.now();
    // Count the attempt atomically first, so parallel guesses can't dodge the lockout (rule 26).
    const reserved = await this.deps.pins.reserveAttempt(personaId, now);
    if (!reserved) {
      assertNotLockedOut(current, now);
      throw new DomainError(ErrorCode.PIN_LOCKED_OUT, 'Too many wrong PINs. Try again later.');
    }
    if (await this.deps.hasher.verify(reserved.pinHash, pin)) {
      await this.deps.pins.setPinState(personaId, PIN_RESET);
      return;
    }
    const lock = lockAfterReservedFailure(reserved.pinFailedCount, reserved.pinLockLevel, now);
    if (lock) {
      await this.deps.pins.setPinState(personaId, lock);
      throw new DomainError(ErrorCode.PIN_LOCKED_OUT, 'Too many wrong PINs. Try again later.', {
        retryAt: lock.pinLockedUntil?.toISOString(),
      });
    }
    throw new DomainError(ErrorCode.PIN_INVALID, 'Wrong PIN', { attemptsLeft: PIN_RULES.attemptsBeforeLock - reserved.pinFailedCount });
  }

  private async issue(actor: Actor, personaId: string): Promise<UnlockResult> {
    return {
      unlockToken: await this.deps.tokens.issue(actor.sessionId, personaId, PIN_RULES.unlockTtlSeconds),
      expiresIn: PIN_RULES.unlockTtlSeconds,
    };
  }

  private async own(actor: Actor, personaId: string): Promise<Persona> {
    const persona = await this.deps.personas.findById(personaId);
    if (!persona || persona.accountId !== actor.accountId || persona.status === 'retired') {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Number not found');
    }
    return persona;
  }

  private changed(persona: Persona) {
    return this.deps.events.publish({
      type: 'persona.updated',
      payload: { accountId: persona.accountId, personaId: persona.id },
      occurredAt: this.deps.clock.now(),
    });
  }
}
