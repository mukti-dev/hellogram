import type { BillingEvent, BillingProvider } from '@hellogram/domain';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  planId: string;
}

interface RazorpayWebhook {
  event: string;
  created_at?: number;
  payload?: {
    subscription?: { entity?: { id: string; current_end?: number | null } };
    payment?: { entity?: { id: string; amount: number } };
  };
}

/**
 * Razorpay Subscriptions over its REST API (UPI Autopay + cards).
 * One subscription per account; `quantity` = number of paid numbers.
 */
export class RazorpayBillingProvider implements BillingProvider {
  readonly name = 'razorpay' as const;

  constructor(private readonly config: RazorpayConfig) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.keyId}:${this.config.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Razorpay ${method} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  async createSubscription(input: { accountRef: string; quantity: number }) {
    const sub = await this.call<{ id: string }>('POST', '/subscriptions', {
      plan_id: this.config.planId,
      total_count: 120,
      quantity: input.quantity,
      customer_notify: 1,
      notes: { ref: input.accountRef },
    });
    return {
      providerSubId: sub.id,
      checkout: { key: this.config.keyId, subscriptionId: sub.id, name: 'Hellogram', description: 'Extra numbers · ₹49/month each' },
    };
  }

  async updateQuantity(providerSubId: string, quantity: number): Promise<void> {
    await this.call('PATCH', `/subscriptions/${providerSubId}`, { quantity, schedule_change_at: 'now' });
  }

  async cancel(providerSubId: string): Promise<void> {
    await this.call('POST', `/subscriptions/${providerSubId}/cancel`, { cancel_at_cycle_end: 0 });
  }

  parseWebhook(rawBody: string, signature: string | undefined): BillingEvent | null {
    if (!verifyRazorpaySignature(rawBody, signature, this.config.webhookSecret)) {
      throw new Error('Invalid webhook signature');
    }
    const body = JSON.parse(rawBody) as RazorpayWebhook;
    const sub = body.payload?.subscription?.entity;
    const payment = body.payload?.payment?.entity;
    if (!sub) return null;
    const eventId = `${body.event}:${sub.id}:${payment?.id ?? body.created_at ?? ''}`;
    switch (body.event) {
      case 'subscription.activated':
      case 'subscription.charged':
        if (!payment) return null;
        return {
          kind: 'charged',
          eventId,
          providerSubId: sub.id,
          providerPaymentId: payment.id,
          amountPaise: payment.amount,
          periodEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
        };
      case 'subscription.pending':
      case 'subscription.halted':
        return { kind: 'payment_failed', eventId, providerSubId: sub.id };
      case 'subscription.cancelled':
      case 'subscription.completed':
        return { kind: 'cancelled', eventId, providerSubId: sub.id };
      default:
        return null;
    }
  }
}

/** X-Razorpay-Signature = hex(HMAC-SHA256(webhookSecret, rawBody)). */
export function verifyRazorpaySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
