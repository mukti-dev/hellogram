import { z } from 'zod';

export const meResponse = z.object({
  phone: z.string(),
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

export const sessionParams = z.object({ id: z.uuid() });
export const startEmailBody = z.object({ email: z.email().max(254) });
export const confirmEmailBody = z.object({ email: z.email().max(254), code: z.string().trim().max(10) });
