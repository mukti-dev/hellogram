import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RazorpayBillingProvider, verifyRazorpaySignature } from './razorpay.provider.js';

const secret = 'whsec_test';
const provider = new RazorpayBillingProvider({ keyId: 'rzp_test', keySecret: 's', webhookSecret: secret, planId: 'plan_x' });
const sign = (body: string) => createHmac('sha256', secret).update(body).digest('hex');

describe('Razorpay webhooks', () => {
  it('rejects bad or missing signatures', () => {
    const body = JSON.stringify({ event: 'subscription.charged' });
    expect(verifyRazorpaySignature(body, sign(body), secret)).toBe(true);
    expect(verifyRazorpaySignature(body, 'deadbeef', secret)).toBe(false);
    expect(verifyRazorpaySignature(body, undefined, secret)).toBe(false);
    expect(() => provider.parseWebhook(body, 'bad')).toThrowError(/signature/);
  });

  it('maps charged / pending / cancelled events', () => {
    const charged = JSON.stringify({
      event: 'subscription.charged',
      payload: {
        subscription: { entity: { id: 'sub_1', current_end: 1790000000 } },
        payment: { entity: { id: 'pay_1', amount: 4900 } },
      },
    });
    expect(provider.parseWebhook(charged, sign(charged))).toMatchObject({
      kind: 'charged',
      providerSubId: 'sub_1',
      providerPaymentId: 'pay_1',
      amountPaise: 4900,
    });
    const halted = JSON.stringify({ event: 'subscription.halted', payload: { subscription: { entity: { id: 'sub_1' } } } });
    expect(provider.parseWebhook(halted, sign(halted))).toMatchObject({ kind: 'payment_failed' });
    const other = JSON.stringify({ event: 'order.paid', payload: {} });
    expect(provider.parseWebhook(other, sign(other))).toBeNull();
  });
});
