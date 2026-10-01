import type { BillingEvent, BillingProvider } from '@hellogram/domain';
import { randomUUID } from 'node:crypto';

/**
 * Development/testing stand-in for Razorpay. Checkout is "paid" by calling
 * POST /v1/billing/dev/confirm, which feeds the same internal event path as a webhook.
 */
export class DevBillingProvider implements BillingProvider {
  readonly name = 'dev' as const;

  async createSubscription() {
    const providerSubId = `dev_sub_${randomUUID()}`;
    return { providerSubId, checkout: { mode: 'simulator' } };
  }

  async updateQuantity(): Promise<void> {}

  async cancel(): Promise<void> {}

  parseWebhook(): BillingEvent | null {
    throw new Error('The dev billing provider has no webhooks');
  }
}
