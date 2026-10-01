import { z } from 'zod';

export const meResponse = z.object({
  phone: z.string(),
  name: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).nullable(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.string(),
});

export const sessionsResponse = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      deviceName: z.string().nullable(),
      userAgent: z.string().nullable(),
      createdAt: z.string(),
      lastSeenAt: z.string(),
      current: z.boolean(),
    }),
  ),
});

export const updateMeBody = z.object({ name: z.string().max(200) });
export const sessionParams = z.object({ id: z.uuid() });
export const startEmailBody = z.object({ email: z.email().max(254) });
export const confirmEmailBody = z.object({ email: z.email().max(254), code: z.string().trim().max(10) });
