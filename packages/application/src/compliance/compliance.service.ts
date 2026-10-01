import {
  DomainError,
  GRIEVANCE_SLA,
  OTP_RULES,
  normalizeIndianMobile,
  type AccountLifecycleRepository,
  type AccountRepository,
  type Actor,
  type AuditRepository,
  type Clock,
  type CryptoService,
  type EventPublisher,
  type GrievanceRepository,
  type PhoneChangeRecord,
  type PhoneProof,
  type RateLimiter,
  type SmsProvider,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { OtpVerifier } from '../auth/otp-verifier.js';
import type { PhoneProofChecker } from '../auth/phone-proof.js';

const HOUR = 60 * 60 * 1000;
export const PHONE_CHANGE_COOLING_OFF_MS = 24 * HOUR;

/** DPDP rights (access, erasure), phone change and grievances. */
export class ComplianceService {
  constructor(
    private readonly deps: {
      lifecycle: AccountLifecycleRepository;
      accounts: AccountRepository;
      grievances: GrievanceRepository;
      audit: AuditRepository;
      otp: OtpVerifier;
      proofs: PhoneProofChecker;
      sms: SmsProvider;
      crypto: CryptoService;
      limiter: RateLimiter;
      events: EventPublisher;
      clock: Clock;
    },
  ) {}

  async exportData(actor: Actor): Promise<Record<string, unknown>> {
    await this.deps.audit.log({ actorType: 'account', actorId: actor.accountId, action: 'account.export' });
    return this.deps.lifecycle.exportData(actor.accountId, actor.unlockedPersonaIds ?? new Set());
  }

  /** Step 1 of deletion: re-verify with an OTP to the account's phone. */
  async sendDeletionOtp(actor: Actor, ip: string): Promise<void> {
    const phone = await this.phoneOf(actor);
    await this.sendOtp(phone, `account_delete:${phone}`, 'account_delete', ip);
  }

  /** Rule 4: irreversible. */
  async deleteAccount(actor: Actor, proof: PhoneProof): Promise<void> {
    const phone = await this.phoneOf(actor);
    const verified = await this.deps.proofs.check(proof, {
      expectedPhone: phone,
      otpTargetHash: (p) => this.deps.crypto.hmac('target', `account_delete:${p}`),
      purpose: 'account_delete',
    });
    await verified.consume();
    const now = this.deps.clock.now();
    await this.deps.lifecycle.deleteAccount(actor.accountId, now);
    await this.deps.audit.log({ actorType: 'account', actorId: actor.accountId, action: 'account.deleted' });
    await this.deps.events.publish({ type: 'account.deleted', payload: { accountId: actor.accountId }, occurredAt: now });
  }

  /** Phone change, step 1: OTP to the *new* number. */
  async startPhoneChange(actor: Actor, newPhoneInput: string, ip: string): Promise<void> {
    const newPhone = normalizeIndianMobile(newPhoneInput);
    // Same response either way, so this can't be used to test which numbers are registered.
    // A taken number simply never receives a code.
    if (await this.deps.lifecycle.isPhoneTaken(newPhone)) return;
    await this.sendOtp(newPhone, `phone_change:${actor.accountId}:${newPhone}`, 'phone_change', ip);
  }

  /** Step 2: verified → takes effect after 24 h; the old number is told (can cancel). */
  async confirmPhoneChange(actor: Actor, newPhoneInput: string, proof: PhoneProof): Promise<PhoneChangeRecord> {
    const newPhone = normalizeIndianMobile(newPhoneInput);
    const verified = await this.deps.proofs.check(proof, {
      expectedPhone: newPhone,
      otpTargetHash: (p) => this.deps.crypto.hmac('target', `phone_change:${actor.accountId}:${p}`),
      purpose: 'phone_change',
    });
    await verified.consume();
    // Only after the code proves control of the number is it safe to say it's taken.
    if (await this.deps.lifecycle.isPhoneTaken(newPhone)) {
      throw new DomainError(ErrorCode.CONFLICT, 'This number can’t be used');
    }
    const now = this.deps.clock.now();
    await this.deps.lifecycle.cancelPhoneChanges(actor.accountId, now);
    const change = await this.deps.lifecycle.createPhoneChange(
      actor.accountId,
      newPhone,
      now,
      new Date(now.getTime() + PHONE_CHANGE_COOLING_OFF_MS),
    );
    const oldPhone = await this.phoneOf(actor);
    await this.deps.sms.sendNotice(oldPhone, 'phone_change_requested');
    await this.deps.audit.log({ actorType: 'account', actorId: actor.accountId, action: 'account.phone_change_requested' });
    return change;
  }

  pendingPhoneChange(actor: Actor) {
    return this.deps.lifecycle.pendingPhoneChange(actor.accountId);
  }

  cancelPhoneChange(actor: Actor) {
    return this.deps.lifecycle.cancelPhoneChanges(actor.accountId, this.deps.clock.now());
  }

  /** Worker. */
  async applyDuePhoneChanges(): Promise<number> {
    const applied = await this.deps.lifecycle.applyDuePhoneChanges(this.deps.clock.now());
    for (const change of applied) {
      await this.deps.audit.log({ actorType: 'system', actorId: null, action: 'account.phone_changed', targetType: 'account', targetId: change.accountId });
    }
    return applied.length;
  }

  /** IT Rules 2021 grievance: acknowledged within 24 h, resolved within 15 days. */
  async submitGrievance(input: { contact: string; subject: string; body: string }): Promise<{ id: string; ackDueAt: Date; resolveDueAt: Date }> {
    const now = this.deps.clock.now();
    const ackDueAt = new Date(now.getTime() + GRIEVANCE_SLA.ackHours * HOUR);
    const resolveDueAt = new Date(now.getTime() + GRIEVANCE_SLA.resolveDays * 24 * HOUR);
    const ticket = await this.deps.grievances.create({
      complainantContact: input.contact.trim(),
      subject: input.subject.trim(),
      body: input.body.trim(),
      ackDueAt,
      resolveDueAt,
    });
    return { id: ticket.id, ackDueAt, resolveDueAt };
  }

  private async phoneOf(actor: Actor): Promise<string> {
    const account = await this.deps.accounts.findById(actor.accountId);
    if (!account) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in again');
    return account.phone;
  }

  private async sendOtp(phone: string, target: string, purpose: 'account_delete' | 'phone_change', ip: string) {
    const targetHash = this.deps.crypto.hmac('target', target);
    if (!(await this.deps.limiter.hit(`otp:send:${targetHash}`, OTP_RULES.sendLimit, OTP_RULES.sendWindowSeconds))) {
      throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many codes requested. Try again later.');
    }
    const code = await this.deps.otp.issue({ channel: 'sms', targetHash, purpose, ipHash: this.deps.crypto.hmac('ip', ip) });
    await this.deps.sms.sendOtp(phone, code);
  }
}
