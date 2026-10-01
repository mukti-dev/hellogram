import {
  DomainError,
  GRACE_DAYS,
  REMINDER_DAYS,
  gstBreakup,
  monthlyAmountPaise,
  planSummary,
  type Actor,
  type BillingEvent,
  type BillingProvider,
  type BillingRepository,
  type Clock,
  type EventPublisher,
  type PaymentRecord,
  type Persona,
  type PersonaRepository,
  type RateLimiter,
  type Subscription,
} from '@hellogram/domain';
import { ErrorCode, LIMITS } from '@hellogram/shared';
import type { CheckoutInfo, NewPersonaInput, PaidNumberCheckout, PersonaService } from '../personas/persona.service.js';

const DAY = 24 * 60 * 60 * 1000;
const DRAFT_TTL_MS = 30 * 60 * 1000;

export interface BillingSummary {
  subscription: (Subscription & { monthlyAmountPaise: number }) | null;
  invoices: PaymentRecord[];
}

export interface Reminder {
  accountId: string;
  day: number;
  graceUntil: Date;
}

/**
 * Paid numbers (rules 5, 9): one subscription per account, quantity = paid numbers.
 * A paid number is only created after payment authorisation.
 */
export class BillingService implements PaidNumberCheckout {
  constructor(
    private readonly deps: {
      billing: BillingRepository;
      provider: BillingProvider;
      personas: PersonaRepository;
      personaService: PersonaService;
      events: EventPublisher;
      clock: Clock;
      limiter: RateLimiter;
    },
  ) {}

  async start(actor: Actor, input: NewPersonaInput & { labelText: string | null }): Promise<CheckoutInfo> {
    const live = await this.deps.personas.listByAccount(actor.accountId);
    const quantity = planSummary(live).paid + 1;
    const now = this.deps.clock.now();
    const draftFields = {
      accountId: actor.accountId,
      displayName: input.displayName,
      labelKind: input.labelKind,
      labelText: input.labelText,
      allowCalls: input.allowCalls,
      expiresAt: new Date(now.getTime() + DRAFT_TTL_MS),
    };

    const existing = await this.deps.billing.findActiveSubscription(actor.accountId);
    if (existing?.status === 'grace') {
      throw new DomainError(ErrorCode.PAYMENT_REQUIRED, 'Your last payment failed. Update your payment method first.');
    }
    if (existing && existing.status === 'active') {
      // The UPI/card mandate is already authorised: raise the quantity and create the number now.
      await this.deps.provider.updateQuantity(existing.providerSubId, quantity);
      await this.deps.billing.updateSubscription(existing.id, { quantity });
      const draft = await this.deps.billing.createDraft({ ...draftFields, providerRef: existing.providerSubId });
      const persona = await this.createFromDraft(draft.id, draftFields, now);
      return { draftId: draft.id, provider: this.deps.provider.name, payload: { status: 'completed', personaId: persona.id } };
    }

    const { providerSubId, checkout } = await this.deps.provider.createSubscription({ accountRef: actor.accountId, quantity });
    await this.deps.billing.createSubscription({ accountId: actor.accountId, provider: this.deps.provider.name, providerSubId, quantity });
    const draft = await this.deps.billing.createDraft({ ...draftFields, providerRef: providerSubId });
    return {
      draftId: draft.id,
      provider: this.deps.provider.name,
      payload: { ...checkout, amountPaise: monthlyAmountPaise(quantity) },
    };
  }

  /** Verified, idempotent webhook entry point. */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<void> {
    let event: BillingEvent | null;
    try {
      event = this.deps.provider.parseWebhook(rawBody, signature);
    } catch {
      throw new DomainError(ErrorCode.FORBIDDEN, 'Invalid signature');
    }
    if (event) await this.apply(event, JSON.parse(rawBody));
  }

  /** Development simulator: behaves exactly like a successful Razorpay charge. */
  async devConfirm(actor: Actor, draftId: string): Promise<{ personaId: string | null }> {
    if (this.deps.provider.name !== 'dev') throw new DomainError(ErrorCode.NOT_FOUND, 'Not available');
    const draft = await this.deps.billing.findDraft(draftId, actor.accountId);
    if (!draft) throw new DomainError(ErrorCode.NOT_FOUND, 'Checkout not found');
    const sub = await this.deps.billing.findActiveSubscription(actor.accountId);
    if (!sub) throw new DomainError(ErrorCode.NOT_FOUND, 'Checkout not found');
    await this.apply(
      {
        kind: 'charged',
        eventId: `dev:${draftId}`,
        providerSubId: sub.providerSubId,
        providerPaymentId: `dev_pay_${draftId}`,
        amountPaise: monthlyAmountPaise(sub.quantity),
        periodEnd: new Date(this.deps.clock.now().getTime() + 30 * DAY),
      },
      { simulated: true },
    );
    return this.draftStatus(actor, draftId);
  }

  /** Dev only: simulate a failed renewal to exercise grace → pause → retire. */
  async devFail(actor: Actor): Promise<void> {
    if (this.deps.provider.name !== 'dev') throw new DomainError(ErrorCode.NOT_FOUND, 'Not available');
    const sub = await this.deps.billing.findActiveSubscription(actor.accountId);
    if (!sub) throw new DomainError(ErrorCode.NOT_FOUND, 'No subscription');
    await this.apply({ kind: 'payment_failed', eventId: `dev-fail:${sub.id}:${Date.now()}`, providerSubId: sub.providerSubId }, {});
  }

  async draftStatus(actor: Actor, draftId: string): Promise<{ personaId: string | null }> {
    const draft = await this.deps.billing.findDraft(draftId, actor.accountId);
    if (!draft) throw new DomainError(ErrorCode.NOT_FOUND, 'Checkout not found');
    return { personaId: draft.consumedPersonaId };
  }

  async summary(actor: Actor): Promise<BillingSummary> {
    const sub = await this.deps.billing.findActiveSubscription(actor.accountId);
    return {
      subscription: sub ? { ...sub, monthlyAmountPaise: monthlyAmountPaise(sub.quantity) } : null,
      invoices: await this.deps.billing.listPayments(actor.accountId),
    };
  }

  invoice(actor: Actor, id: string) {
    return this.deps.billing.findPayment(id, actor.accountId);
  }

  /**
   * Keeps quantity = max(0, live numbers − 2) after a number is deleted.
   * If a free number goes while paid ones remain, a paid one becomes free.
   */
  async reconcileAfterRetire(accountId: string): Promise<void> {
    const live = await this.deps.personas.listByAccount(accountId);
    const desiredPaid = Math.max(0, live.length - LIMITS.FREE_PERSONAS);
    const paid = live.filter((p) => p.isPaid).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const p of paid.slice(0, Math.max(0, paid.length - desiredPaid))) await this.deps.personas.markPaid(p.id, false);

    const sub = await this.deps.billing.findActiveSubscription(accountId);
    if (!sub || sub.quantity === desiredPaid) return;
    if (desiredPaid === 0) {
      await this.deps.provider.cancel(sub.providerSubId);
      await this.deps.billing.updateSubscription(sub.id, { quantity: 0, status: 'cancelled' });
    } else {
      await this.deps.provider.updateQuantity(sub.providerSubId, desiredPaid);
      await this.deps.billing.updateSubscription(sub.id, { quantity: desiredPaid });
    }
  }

  /** Worker: grace over → retire the paid numbers (rule 9). */
  async expireGrace(): Promise<number> {
    const now = this.deps.clock.now();
    let retired = 0;
    for (const sub of await this.deps.billing.graceExpired(now)) {
      for (const p of (await this.deps.personas.listByAccount(sub.accountId)).filter((x) => x.isPaid)) {
        await this.deps.personas.retire(p.id, now);
        await this.publishPersona(p, 'persona.retired');
        retired++;
      }
      await this.deps.provider.cancel(sub.providerSubId).catch(() => undefined);
      await this.deps.billing.updateSubscription(sub.id, { status: 'cancelled', quantity: 0 });
    }
    return retired;
  }

  /** Worker: reminders at renewal failure, day 3 and day 6 (each sent once). */
  async dueReminders(): Promise<Reminder[]> {
    const now = this.deps.clock.now();
    const due: Reminder[] = [];
    for (const sub of await this.deps.billing.inGrace()) {
      if (!sub.graceUntil) continue;
      const day = Math.floor((now.getTime() - (sub.graceUntil.getTime() - GRACE_DAYS * DAY)) / DAY);
      if (!(REMINDER_DAYS as readonly number[]).includes(day)) continue;
      // Sent once per day index: the limiter key doubles as a dedupe flag.
      if (await this.deps.limiter.hit(`billing-reminder:${sub.id}:${day}`, 1, 8 * 24 * 60 * 60)) {
        due.push({ accountId: sub.accountId, day, graceUntil: sub.graceUntil });
      }
    }
    return due;
  }

  private async apply(event: BillingEvent, raw: unknown): Promise<void> {
    if (!(await this.deps.billing.recordWebhook(event.eventId, this.deps.provider.name, event.kind, raw))) return;
    const sub = await this.deps.billing.findByProviderId(event.providerSubId);
    if (!sub) return;
    const now = this.deps.clock.now();

    if (event.kind === 'charged') {
      const wasGrace = sub.status === 'grace';
      await this.deps.billing.updateSubscription(sub.id, { status: 'active', currentPeriodEnd: event.periodEnd, graceUntil: null });
      const { gstPaise } = gstBreakup(event.amountPaise);
      await this.deps.billing.addPayment({
        subscriptionId: sub.id,
        amountPaise: event.amountPaise,
        gstPaise,
        providerPaymentId: event.providerPaymentId,
        paidAt: now,
      });
      for (const draft of await this.deps.billing.openDraftsFor(sub.providerSubId, now)) {
        await this.createFromDraft(draft.id, draft, now);
      }
      if (wasGrace) {
        for (const p of await this.deps.personas.listByAccount(sub.accountId)) {
          if (p.status === 'paused' && p.pauseReason === 'billing') {
            await this.deps.personas.setStatus(p.id, 'active', null);
            await this.publishPersona(p, 'persona.updated');
          }
        }
      }
      return;
    }

    if (event.kind === 'payment_failed' && sub.status !== 'grace') {
      await this.deps.billing.updateSubscription(sub.id, { status: 'grace', graceUntil: new Date(now.getTime() + GRACE_DAYS * DAY) });
      // Rule 9: paid numbers pause for 7 days — chats readable, no sending or receiving.
      for (const p of await this.deps.personas.listByAccount(sub.accountId)) {
        if (p.isPaid && p.status === 'active') {
          await this.deps.personas.setStatus(p.id, 'paused', 'billing');
          await this.publishPersona(p, 'persona.updated');
        }
      }
      await this.deps.events.publish({ type: 'billing.grace_started', payload: { accountId: sub.accountId }, occurredAt: now });
      return;
    }

    if (event.kind === 'cancelled' && sub.status !== 'cancelled') {
      await this.deps.billing.updateSubscription(sub.id, { status: 'cancelled' });
    }
  }

  private async createFromDraft(
    draftId: string,
    d: { accountId: string; displayName: string; labelKind: Persona['labelKind']; labelText: string | null; allowCalls: boolean },
    now: Date,
  ): Promise<Persona> {
    const persona = await this.deps.personaService.createWithUniqueCode({
      accountId: d.accountId,
      displayName: d.displayName,
      labelKind: d.labelKind,
      labelText: d.labelText,
      allowCalls: d.allowCalls,
      isPaid: true,
    });
    await this.deps.billing.consumeDraft(draftId, persona.id, now);
    await this.publishPersona(persona, 'persona.updated');
    return persona;
  }

  private publishPersona(p: Persona, type: 'persona.updated' | 'persona.retired') {
    return this.deps.events.publish({
      type,
      payload: { accountId: p.accountId, personaId: p.id, wasPaid: p.isPaid },
      occurredAt: this.deps.clock.now(),
    });
  }
}
