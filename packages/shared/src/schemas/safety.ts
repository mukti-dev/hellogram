import { z } from 'zod';

export const REPORT_REASONS = ['harassment', 'spam', 'scam', 'sexual_content', 'threat', 'other'] as const;

export const reportBody = z
  .object({
    conversationId: z.uuid().optional(),
    requestId: z.uuid().optional(),
    reason: z.enum(REPORT_REASONS),
    note: z.string().max(1000).nullish(),
    alsoBlock: z.boolean().default(true),
  })
  .refine((b) => Boolean(b.conversationId) !== Boolean(b.requestId), 'Report a chat or a request');
export type ReportBody = z.input<typeof reportBody>;
