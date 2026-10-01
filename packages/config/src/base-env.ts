import { z } from 'zod';

/** Settings every backend process needs. Apps extend this with their own keys. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;
