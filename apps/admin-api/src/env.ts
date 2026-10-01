import { baseEnvSchema, loadEnv } from '@hellogram/config';
import { z } from 'zod';

export const adminEnvSchema = baseEnvSchema
  .extend({
    PORT: z.coerce.number().int().positive().default(4100),
    // Bind to localhost by default: expose only through a VPN / Cloudflare Access.
    HOST: z.string().default('127.0.0.1'),
    ADMIN_JWT_SECRET: z.string().min(32),
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((v): boolean | number | string[] => (v === 'false' ? false : /^\d+$/.test(v) ? Number(v) : v.split(',').map((s) => s.trim()))),
    ADMIN_CORS_ORIGINS: z
      .string()
      .default('http://localhost:5174')
      .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.ADMIN_JWT_SECRET.startsWith('dev-only')) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_JWT_SECRET'], message: 'set a real secret in production' });
    }
  });

export type AdminEnv = z.infer<typeof adminEnvSchema>;
export const loadAdminEnv = (source?: Record<string, string | undefined>) => loadEnv(adminEnvSchema, source ? { source } : {});
