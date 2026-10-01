import type { PhoneProof } from '@hellogram/domain';
import { z } from 'zod';

/** Adds "code (our OTP) or idToken (Firebase)" — exactly one — to a request body schema. */
export const withProof = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema
    .extend({ code: z.string().max(10).optional(), idToken: z.string().min(20).max(4096).optional() })
    .refine((b) => {
      const p = b as { code?: string; idToken?: string };
      return Boolean(p.code) !== Boolean(p.idToken);
    }, 'Send either a code or an idToken');

export const toProof = (body: { code?: string | undefined; idToken?: string | undefined }): PhoneProof =>
  body.idToken ? { idToken: body.idToken } : { code: body.code ?? '' };
