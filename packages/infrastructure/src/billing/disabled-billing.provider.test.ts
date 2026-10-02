import { describe, expect, it } from 'vitest';
import { DisabledEmailProvider } from '../providers/disabled-email.provider.js';
import { DisabledBillingProvider } from './disabled-billing.provider.js';

const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);

describe('running without payments or email', () => {
  it('refuses to start a purchase, with a message people can read', async () => {
    const billing = new DisabledBillingProvider();
    expect(await codeOf(billing.createSubscription())).toBe('SERVICE_UNAVAILABLE');
    expect(await codeOf(billing.updateQuantity())).toBe('SERVICE_UNAVAILABLE');
    await expect(billing.cancel()).resolves.toBeUndefined();
    expect(() => billing.parseWebhook()).toThrow();
  });

  it('refuses to send email codes', async () => {
    expect(await codeOf(new DisabledEmailProvider().sendOtp())).toBe('SERVICE_UNAVAILABLE');
  });
});
