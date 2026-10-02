import { DomainError, type BillingProvider } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

/**
 * Production without a payment provider yet (BILLING_PROVIDER=none): free numbers work as usual,
 * buying an extra number is refused until Razorpay is configured.
 */
export class DisabledBillingProvider implements BillingProvider {
  readonly name = 'none' as const;

  async createSubscription(): Promise<never> {
    throw new DomainError(ErrorCode.SERVICE_UNAVAILABLE, "Extra numbers can't be bought yet. Please try again later.");
  }

  async updateQuantity(): Promise<never> {
    throw new DomainError(ErrorCode.SERVICE_UNAVAILABLE, "Extra numbers can't be bought yet. Please try again later.");
  }

  async cancel(): Promise<void> {}

  parseWebhook(): never {
    throw new Error('Payments are not enabled');
  }
}
