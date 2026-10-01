import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'degraded', 'down']);

export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  checks: z.record(z.string(), healthStatusSchema),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
