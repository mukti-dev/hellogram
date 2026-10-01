import { baseEnvSchema, checkIntegrations, integrationsEnvSchema, loadEnv } from '@hellogram/config';
import { z } from 'zod';

export const apiEnvSchema = baseEnvSchema
  .extend(integrationsEnvSchema.shape)
  .extend({
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default('0.0.0.0'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
    PUBLIC_BASE_URL: z.url(),
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    /** Server secret for keyed hashes (phone/email lookups, IPs, refresh tokens, OTP codes). */
    HASH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    CONSENT_VERSION: z.string().default('2026-09-v1'),
    SESSION_TTL_DAYS: z.coerce.number().int().positive().default(90),
    COOKIE_SECURE: z.stringbool().optional(),
    /** TESTING ONLY — accept any 6-digit OTP. Refused in production. */
    OTP_BYPASS: z.stringbool().default(false),
    /** Scales per-IP route limits for local testing. Forced to 1 in production. */
    RATE_LIMIT_MULTIPLIER: z.coerce.number().positive().default(1),
    /** Number code digits (6 now, 7 once ~60% of the 6-digit space is used). */
    CODE_DIGITS: z.coerce.number().int().min(6).max(7).default(6),
    MEDIA_DIR: z.string().default('.data/media'),
    /** Comma-separated TURN URLs handed to clients (relay-only calls). */
    TURN_URLS: z
      .string()
      .default('turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp')
      .transform((v) => v.split(',').map((u) => u.trim()).filter(Boolean)),
    /** "console" logs codes (dev only); production needs real providers. */
    SMS_PROVIDER: z.enum(['console', 'msg91', 'none']).default('console'),
    /**
     * "otp": our own SMS codes (via SMS_PROVIDER). "firebase": Firebase Phone Auth sends and checks
     * the SMS on the device; we verify Google's ID token. Needs FIREBASE_PROJECT_ID.
     */
    PHONE_AUTH_PROVIDER: z.enum(['otp', 'firebase']).default('otp'),
    FIREBASE_PROJECT_ID: z.string().optional(),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().optional(),
    MSG91_NOTICE_TEMPLATE_ID: z.string().optional(),
    EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('Hellogram <no-reply@hellogram.app>'),
    /** Bot check before OTP sends and grievances. Required in production. */
    TURNSTILE_SECRET: z.string().optional(),
    /**
     * Which proxies to trust for the client IP (rate limits key on it):
     * "false" (direct), a hop count ("1" behind Caddy), or comma-separated CIDRs.
     */
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((v): boolean | number | string[] => (v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v.split(',').map((s) => s.trim()))),
    GRIEVANCE_OFFICER_NAME: z.string().default('Grievance Officer (to be appointed)'),
    GRIEVANCE_OFFICER_EMAIL: z.string().default('grievance@hellogram.app'),
    TURN_SHARED_SECRET: z.string().min(16).default('dev-turn-secret-change-me'),
    /** Public base URL for stored media (dev: served by the API under /media). */
    MEDIA_PUBLIC_URL: z.string().default('/media'),
  })
  .superRefine((env, ctx) => {
    checkIntegrations(env, (path, message) => ctx.addIssue({ code: 'custom', path: [path], message }));
    if (env.NODE_ENV === 'production' && env.RATE_LIMIT_MULTIPLIER !== 1) {
      ctx.addIssue({ code: 'custom', path: ['RATE_LIMIT_MULTIPLIER'], message: 'must be 1 in production' });
    }
    if (env.NODE_ENV === 'production' && env.TURN_SHARED_SECRET === 'dev-turn-secret-change-me') {
      ctx.addIssue({ code: 'custom', path: ['TURN_SHARED_SECRET'], message: 'set a real secret in production' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.SMS_PROVIDER === 'console') ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'console logs OTPs — not allowed in production' });
      if (env.PHONE_AUTH_PROVIDER === 'otp' && env.SMS_PROVIDER !== 'msg91') {
        ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'must be msg91 when PHONE_AUTH_PROVIDER=otp' });
      }
      if (env.EMAIL_PROVIDER !== 'smtp') ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'must be smtp in production' });
      if (!env.TURNSTILE_SECRET) ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SECRET'], message: 'required in production' });
      if (env.TRUST_PROXY === false) ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: 'set to the proxy hop count or CIDRs in production' });
    }
    if (env.SMS_PROVIDER === 'msg91' && !(env.MSG91_AUTH_KEY && env.MSG91_OTP_TEMPLATE_ID && env.MSG91_NOTICE_TEMPLATE_ID)) {
      ctx.addIssue({ code: 'custom', path: ['MSG91_AUTH_KEY'], message: 'MSG91 key and template ids are required' });
    }
    if (env.PHONE_AUTH_PROVIDER === 'firebase' && !env.FIREBASE_PROJECT_ID) {
      ctx.addIssue({ code: 'custom', path: ['FIREBASE_PROJECT_ID'], message: 'required when PHONE_AUTH_PROVIDER=firebase' });
    }
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'required when EMAIL_PROVIDER=smtp' });
    }
    if (env.NODE_ENV === 'production' && env.OTP_BYPASS) {
      ctx.addIssue({ code: 'custom', path: ['OTP_BYPASS'], message: 'must never be enabled in production' });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const loadApiEnv = (source?: Record<string, string | undefined>): ApiEnv =>
  loadEnv(apiEnvSchema, source ? { source } : {});
