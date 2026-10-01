import { z } from 'zod';

/** Billing + push settings shared by the API and the worker. */
export const integrationsEnvSchema = z.object({
  BILLING_PROVIDER: z.enum(['dev', 'razorpay']).default('dev'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_PLAN_ID: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:support@hellogram.app'),
});

export type IntegrationsEnv = z.infer<typeof integrationsEnvSchema>;

export function checkIntegrations(env: IntegrationsEnv & { NODE_ENV: string }, addIssue: (path: string, message: string) => void) {
  if (env.BILLING_PROVIDER === 'razorpay') {
    for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_PLAN_ID'] as const) {
      if (!env[key]) addIssue(key, 'required when BILLING_PROVIDER=razorpay');
    }
  }
  if (env.NODE_ENV === 'production' && env.BILLING_PROVIDER !== 'razorpay') {
    addIssue('BILLING_PROVIDER', 'must be razorpay in production');
  }
}
