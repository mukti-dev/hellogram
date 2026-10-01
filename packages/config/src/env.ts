import { config as loadDotenv } from 'dotenv';
import type { z } from 'zod';

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Loads `.env` (if present) and validates `process.env` against a Zod schema.
 * Fails fast at boot so misconfiguration never reaches runtime.
 */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  options: { envFile?: string; source?: Record<string, string | undefined> } = {},
): z.infer<S> {
  if (!options.source) {
    loadDotenv({ path: options.envFile ?? '.env', quiet: true });
  }
  const result = schema.safeParse(options.source ?? process.env);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
