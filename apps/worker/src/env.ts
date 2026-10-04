import { baseEnvSchema, checkIntegrations, checkStorage, integrationsEnvSchema, loadEnv, storageEnvSchema } from '@hellogram/config';
import { z } from 'zod';

export const workerEnvSchema = baseEnvSchema
  .extend(integrationsEnvSchema.shape)
  .extend(storageEnvSchema.shape)
  .extend({
    PUBLIC_BASE_URL: z.url().default('http://localhost:5173'),
    CODE_DIGITS: z.coerce.number().int().min(6).max(7).default(6),
    /** Profile photos (shared with the API): replaced ones are destroyed here after 30 days. */
    MEDIA_DIR: z.string().default('.data/media'),
  })
  .superRefine((env, ctx) => {
    checkIntegrations(env, (path, message) => ctx.addIssue({ code: 'custom', path: [path], message }));
    checkStorage(env, (path, message) => ctx.addIssue({ code: 'custom', path: [path], message }));
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export const loadWorkerEnv = () => loadEnv(workerEnvSchema);
