import type { LabelIcon } from '@hellogram/shared';
import { LIMITS } from '@hellogram/shared';

export type SubscriptionStatus = 'created' | 'authenticated' | 'active' | 'past_due' | 'grace' | 'cancelled' | 'completed';

export interface Subscription {
  id: string;
  accountId: string;
  provider: string;
  providerSubId: string;
  quantity: number;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
}

export interface PaymentRecord {
  id: string;
  invoiceNo: string;
  amountPaise: number;
  gstPaise: number;
  paidAt: Date;
}

export const GRACE_DAYS = 7;
export const REMINDER_DAYS = [0, 3, 6] as const;
export const GST_RATE = 0.18;

/** ₹49 is GST-inclusive: GST = 49 × 18/118. */
export function gstBreakup(totalPaise: number): { gstPaise: number; basePaise: number } {
  const gstPaise = Math.round((totalPaise * GST_RATE) / (1 + GST_RATE));
  return { gstPaise, basePaise: totalPaise - gstPaise };
}

export const monthlyAmountPaise = (quantity: number) => quantity * LIMITS.PAID_PERSONA_PRICE_PAISE;

/** Invoice numbers: HG/<FY>/<6-digit sequence>, Indian financial year (Apr–Mar). */
export function invoiceNumber(sequence: number, at: Date): string {
  const year = at.getUTCMonth() >= 3 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
  return `HG/${year}-${String((year + 1) % 100).padStart(2, '0')}/${String(sequence).padStart(6, '0')}`;
}

/** Normalised provider events (Razorpay webhooks, or the dev simulator). */
export type BillingEvent =
  | { kind: 'charged'; eventId: string; providerSubId: string; providerPaymentId: string; amountPaise: number; periodEnd: Date | null }
  | { kind: 'payment_failed'; eventId: string; providerSubId: string }
  | { kind: 'cancelled'; eventId: string; providerSubId: string };

export interface BillingProvider {
  readonly name: 'razorpay' | 'dev';
  /** New subscription for `quantity` paid numbers. Returns what the client needs to pay. */
  createSubscription(input: { accountRef: string; quantity: number }): Promise<{ providerSubId: string; checkout: Record<string, unknown> }>;
  updateQuantity(providerSubId: string, quantity: number): Promise<void>;
  cancel(providerSubId: string): Promise<void>;
  /** Verifies and normalises a webhook. Returns null for events we ignore. Throws on a bad signature. */
  parseWebhook(rawBody: string, signature: string | undefined): BillingEvent | null;
}

export interface BillingRepository {
  findActiveSubscription(accountId: string): Promise<Subscription | null>;
  findByProviderId(providerSubId: string): Promise<Subscription | null>;
  createSubscription(input: { accountId: string; provider: string; providerSubId: string; quantity: number }): Promise<Subscription>;
  updateSubscription(id: string, patch: Partial<Pick<Subscription, 'quantity' | 'status' | 'currentPeriodEnd' | 'graceUntil'>>): Promise<void>;
  createDraft(input: {
    accountId: string;
    displayName: string;
    labelIcon: string;
    labelName: string;
    allowCalls: boolean;
    allowMedia: boolean;
    providerRef: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  openDraftsFor(providerSubId: string, now: Date): Promise<DraftRow[]>;
  findDraft(id: string, accountId: string): Promise<(DraftRow & { consumedPersonaId: string | null }) | null>;
  consumeDraft(id: string, personaId: string, at: Date): Promise<boolean>;
  /** Idempotency: true the first time an event id is seen. */
  recordWebhook(eventId: string, provider: string, type: string, payload: unknown): Promise<boolean>;
  addPayment(input: { subscriptionId: string; amountPaise: number; gstPaise: number; providerPaymentId: string; paidAt: Date }): Promise<PaymentRecord | null>;
  listPayments(accountId: string): Promise<PaymentRecord[]>;
  findPayment(id: string, accountId: string): Promise<PaymentRecord | null>;
  graceExpired(now: Date): Promise<Subscription[]>;
  inGrace(): Promise<Subscription[]>;
}

export interface DraftRow {
  id: string;
  accountId: string;
  displayName: string;
  labelIcon: LabelIcon;
  labelName: string;
  allowCalls: boolean;
  allowMedia: boolean;
}
