import {
  DomainError,
  OTP_RULES,
  PIN_RESET,
  VAULT_RULES,
  assertValidPin,
  isReadable,
  lockAfterReservedFailure,
  vaultTtlSeconds,
  type AccountRepository,
  type Actor,
  type Clock,
  type ConversationRepository,
  type ConversationView,
  type CryptoService,
  type EventPublisher,
  type PersonaRepository,
  type PhoneProof,
  type PinHasher,
  type RateLimiter,
  type VaultAccess,
  type VaultRepository,
  type VaultSpace,
  type VaultSubject,
  type VaultTokenStore,
} from '@hellogram/domain';
import { ErrorCode, type VaultOpenDuration, type VaultResetTarget } from '@hellogram/shared';
import type { OtpVerifier } from '../auth/otp-verifier.js';
import type { PhoneProofChecker } from '../auth/phone-proof.js';

export interface VaultDeps {
  vault: VaultRepository;
  conversations: ConversationRepository;
  personas: PersonaRepository;
  accounts: AccountRepository;
  hasher: PinHasher;
  tokens: VaultTokenStore;
  otp: OtpVerifier;
  proofs: PhoneProofChecker;
  limiter: RateLimiter;
  crypto: CryptoService;
  events: EventPublisher;
  clock: Clock;
}

export interface VaultToken {
  token: string;
  expiresAt: Date;
}

export type VaultTarget = 'inbox' | 'archived' | 'locked' | 'hidden';

const wrongPin = () => new DomainError(ErrorCode.PIN_INVALID, 'Wrong PIN');
const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Chat not found');

/**
 * Chat vault: archive, lock (one chat lock PIN per account) and hide (each hide PIN is its own
 * space). Separate from the per-number PIN, which still applies on top.
 */
export class VaultService {
  constructor(private readonly deps: VaultDeps) {}

  /** Validates X-Vault-Unlock tokens for this device. */
  async resolve(actor: Pick<Actor, 'accountId' | 'sessionId'>, tokens: string[]): Promise<VaultAccess> {
    const chats = new Set<string>();
    const spaces = new Set<string>();
    for (const token of tokens.slice(0, 20)) {
      const subject = await this.deps.tokens.verify(actor.accountId, actor.sessionId, token);
      if (subject?.kind === 'chat') chats.add(subject.id);
      if (subject?.kind === 'space') spaces.add(subject.id);
    }
    return { chats, spaces };
  }

  async summary(actor: Actor): Promise<{ lockPinSet: boolean; archived: number; locked: number }> {
    const readable = (await this.deps.personas.listByAccount(actor.accountId)).filter((p) => isReadable(p, actor.unlockedPersonaIds));
    const [pins, counts] = await Promise.all([this.deps.vault.getPins(actor.accountId), this.deps.vault.counts(readable.map((p) => p.id))]);
    return { lockPinSet: Boolean(pins.lockPinHash), ...counts };
  }

  /** Set the chat lock PIN, or change it (needs the current one). Every device has to unlock again. */
  async setLockPin(actor: Actor, pin: string, currentPin?: string): Promise<void> {
    assertValidPin(pin);
    const pins = await this.deps.vault.getPins(actor.accountId);
    if (pins.lockPinHash) {
      if (!currentPin) throw new DomainError(ErrorCode.PIN_INVALID, 'Enter your current PIN');
      await this.checkLockPin(actor.accountId, currentPin);
    }
    await this.deps.vault.setLockPinHash(actor.accountId, await this.deps.hasher.hash(pin));
    await this.deps.tokens.revokeAll(actor.accountId, 'chat');
  }

  /** Archive, lock, hide or bring back a chat (this side only). */
  async move(actor: Actor, conversationId: string, to: VaultTarget, pin?: string, newSpace = false): Promise<void> {
    const view = await this.own(actor, conversationId);
    const { me } = view;
    if (me.vault === 'hidden' && !(me.vaultSpaceId && actor.vault?.spaces.has(me.vaultSpaceId))) throw notFound();
    if (me.vault === 'locked' && to !== 'locked' && !actor.vault?.chats.has(conversationId)) {
      if (!pin) throw new DomainError(ErrorCode.CHAT_LOCKED, 'Enter your chat lock PIN', { conversationId });
      await this.checkLockPin(actor.accountId, pin);
    }

    if (to === 'inbox' || to === 'archived') {
      await this.deps.vault.setState(conversationId, view.myPersona.id, to === 'inbox' ? null : 'archived', null);
    } else if (to === 'locked') {
      if (!pin) throw new DomainError(ErrorCode.PIN_INVALID, 'Enter your chat lock PIN');
      await this.checkLockPin(actor.accountId, pin);
      await this.deps.vault.setState(conversationId, view.myPersona.id, 'locked', null);
    } else {
      if (!pin) throw new DomainError(ErrorCode.PIN_INVALID, 'Enter a PIN');
      assertValidPin(pin);
      const space = await this.spaceForHiding(actor.accountId, pin, newSpace);
      await this.deps.vault.setState(conversationId, view.myPersona.id, 'hidden', space.id);
    }
    await this.changed(actor, conversationId);
  }

  /** Open a locked chat on this device for `duration` (0 = until the user leaves it). */
  async openChat(actor: Actor, conversationId: string, pin: string, duration: VaultOpenDuration): Promise<VaultToken> {
    const view = await this.own(actor, conversationId);
    if (view.me.vault === 'hidden' && !(view.me.vaultSpaceId && actor.vault?.spaces.has(view.me.vaultSpaceId))) throw notFound();
    await this.checkLockPin(actor.accountId, pin);
    return this.issue(actor, { kind: 'chat', id: conversationId }, duration);
  }

  /** The eye button: a hide PIN opens its space on this device for `duration`. */
  async reveal(actor: Actor, pin: string, duration: VaultOpenDuration): Promise<VaultToken> {
    assertValidPin(pin);
    const space = await this.matchSpace(actor.accountId, pin);
    if (!space) throw wrongPin();
    return this.issue(actor, { kind: 'space', id: space.id }, duration);
  }

  /** Forgot PIN, step 1: a code to the account's own phone. */
  async sendResetOtp(actor: Actor, ip: string): Promise<void> {
    const account = await this.deps.accounts.findById(actor.accountId);
    if (!account) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in again');
    const targetHash = this.resetTarget(account.phone, actor.accountId);
    const allowed = await this.deps.limiter.hit(`otp:send:${targetHash}`, OTP_RULES.sendLimit, OTP_RULES.sendWindowSeconds);
    if (!allowed) throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many codes requested. Try again later.');
    await this.deps.otp.sendSms(account.phone, { targetHash, purpose: 'pin_reset', ipHash: this.deps.crypto.hmac('ip', ip) });
  }

  /**
   * Forgot PIN, step 2: `lock` sets a new chat lock PIN (locked chats stay locked);
   * `hidden` brings every hidden chat back to the inbox, since a forgotten PIN can't say which space it was.
   */
  async reset(actor: Actor, proof: PhoneProof, target: VaultResetTarget, newPin?: string): Promise<void> {
    if (target === 'lock') {
      if (!newPin) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Choose a new PIN');
      assertValidPin(newPin);
    }
    const account = await this.deps.accounts.findById(actor.accountId);
    if (!account) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in again');
    const verified = await this.deps.proofs.check(proof, {
      expectedPhone: account.phone,
      otpTargetHash: (phone) => this.resetTarget(phone, actor.accountId),
      purpose: 'pin_reset',
    });
    await verified.consume();

    if (target === 'lock' && newPin) {
      await this.deps.vault.setLockPinHash(actor.accountId, await this.deps.hasher.hash(newPin));
      await this.deps.tokens.revokeAll(actor.accountId, 'chat');
    } else {
      await this.deps.vault.unhideAll(actor.accountId);
      await this.deps.vault.setPinState(actor.accountId, 'hide', PIN_RESET);
      await this.deps.tokens.revokeAll(actor.accountId, 'space');
      await this.changed(actor, null);
    }
  }

  /** My side of the chat, with membership and the number PIN enforced. */
  private async own(actor: Actor, conversationId: string): Promise<ConversationView> {
    const mine = await this.deps.personas.listByAccount(actor.accountId);
    const view = await this.deps.conversations.findViewForAccount(conversationId, mine.map((p) => p.id));
    if (!view || view.me.hiddenAt) throw notFound();
    if (!isReadable(view.myPersona, actor.unlockedPersonaIds)) {
      throw new DomainError(ErrorCode.PERSONA_LOCKED, 'Unlock this number to see its chats', { personaId: view.myPersona.id });
    }
    return view;
  }

  private async spaceForHiding(accountId: string, pin: string, newSpace: boolean): Promise<VaultSpace> {
    const now = this.deps.clock.now();
    const reserved = await this.deps.vault.reserveAttempt(accountId, 'hide', now);
    if (!reserved) throw await this.lockedOut(accountId, 'hide');
    const spaces = await this.deps.vault.listSpaces(accountId);
    for (const space of spaces) {
      if (await this.deps.hasher.verify(space.pinHash, pin)) {
        await this.deps.vault.setPinState(accountId, 'hide', PIN_RESET);
        return space;
      }
    }
    if (!newSpace) {
      // Counted like a wrong PIN, so hiding can't be used to find someone's hide PIN.
      await this.afterFailure(accountId, 'hide', reserved, now);
      throw new DomainError(ErrorCode.VAULT_NEW_PIN, 'This PIN doesn’t open any hidden chats yet. Enter it again to start a new one.');
    }
    if (spaces.length >= VAULT_RULES.maxSpaces) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, `You can use up to ${VAULT_RULES.maxSpaces} hide PINs. Use one you already have.`);
    }
    await this.deps.vault.setPinState(accountId, 'hide', PIN_RESET);
    return this.deps.vault.createSpace(accountId, await this.deps.hasher.hash(pin));
  }

  private async matchSpace(accountId: string, pin: string): Promise<VaultSpace | null> {
    const now = this.deps.clock.now();
    const reserved = await this.deps.vault.reserveAttempt(accountId, 'hide', now);
    if (!reserved) throw await this.lockedOut(accountId, 'hide');
    for (const space of await this.deps.vault.listSpaces(accountId)) {
      if (await this.deps.hasher.verify(space.pinHash, pin)) {
        await this.deps.vault.setPinState(accountId, 'hide', PIN_RESET);
        return space;
      }
    }
    await this.afterFailure(accountId, 'hide', reserved, now);
    return null;
  }

  private async checkLockPin(accountId: string, pin: string): Promise<void> {
    const pins = await this.deps.vault.getPins(accountId);
    if (!pins.lockPinHash) throw new DomainError(ErrorCode.VAULT_PIN_NOT_SET, 'Set a chat lock PIN first');
    const now = this.deps.clock.now();
    const reserved = await this.deps.vault.reserveAttempt(accountId, 'lock', now);
    if (!reserved) throw await this.lockedOut(accountId, 'lock');
    if (await this.deps.hasher.verify(pins.lockPinHash, pin)) {
      await this.deps.vault.setPinState(accountId, 'lock', PIN_RESET);
      return;
    }
    await this.afterFailure(accountId, 'lock', reserved, now);
    throw wrongPin();
  }

  private async afterFailure(accountId: string, which: 'lock' | 'hide', reserved: { failedCount: number; lockLevel: number }, now: Date) {
    const lock = lockAfterReservedFailure(reserved.failedCount, reserved.lockLevel, now);
    if (!lock) return;
    await this.deps.vault.setPinState(accountId, which, lock);
    throw new DomainError(ErrorCode.PIN_LOCKED_OUT, 'Too many wrong PINs. Try again later.', { retryAt: lock.pinLockedUntil?.toISOString() });
  }

  private async lockedOut(accountId: string, which: 'lock' | 'hide') {
    const pins = await this.deps.vault.getPins(accountId);
    const until = pins[which].pinLockedUntil;
    return new DomainError(ErrorCode.PIN_LOCKED_OUT, 'Too many wrong PINs. Try again later.', until ? { retryAt: until.toISOString() } : undefined);
  }

  private async issue(actor: Actor, subject: VaultSubject, duration: VaultOpenDuration): Promise<VaultToken> {
    const ttl = vaultTtlSeconds(duration);
    const token = await this.deps.tokens.issue(actor.accountId, actor.sessionId, subject, ttl);
    return { token, expiresAt: new Date(this.deps.clock.now().getTime() + ttl * 1000) };
  }

  /** Vault moves are private: only this account's devices refresh their inbox and vault. */
  private changed(actor: Actor, conversationId: string | null) {
    return this.deps.events.publish({
      type: 'vault.updated',
      payload: { accountId: actor.accountId, conversationId },
      occurredAt: this.deps.clock.now(),
    });
  }

  private resetTarget(phone: string, accountId: string) {
    return this.deps.crypto.hmac('target', `vault_reset:${accountId}:${phone}`);
  }
}
