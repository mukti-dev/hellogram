import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { labelKindSchema } from './personas.js';

/**
 * Someone else's number. Only these four fields ever describe another user
 * (rule 13 / golden rule) — no account id, phone, email, label or dates.
 */
export const counterpartSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type CounterpartDto = z.infer<typeof counterpartSchema>;

/** Brief view of one of *my* numbers, for "to OLX" / "via Dating" chips. */
export const ownPersonaBriefSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  displayName: z.string(),
  labelKind: labelKindSchema,
  labelText: z.string().nullable(),
});
export type OwnPersonaBriefDto = z.infer<typeof ownPersonaBriefSchema>;

export const publicCardSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  acceptsRequests: z.boolean(),
});
export type PublicCardDto = z.infer<typeof publicCardSchema>;

export const incomingRequestSchema = z.object({
  id: z.uuid(),
  from: counterpartSchema,
  to: ownPersonaBriefSchema,
  introMessage: z.string(),
  status: z.enum(['pending', 'blocked']),
  createdAt: z.string(),
});
export type IncomingRequestDto = z.infer<typeof incomingRequestSchema>;

export const sentRequestSchema = z.object({
  id: z.uuid(),
  from: ownPersonaBriefSchema,
  to: counterpartSchema,
  introMessage: z.string(),
  /** A blocked request is shown to its sender as still pending (rule 15). */
  status: z.enum(['pending', 'accepted', 'declined', 'expired']),
  createdAt: z.string(),
});
export type SentRequestDto = z.infer<typeof sentRequestSchema>;

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const sendRequestBody = z.object({
  fromPersonaId: z.uuid(),
  toCode: z.string().trim().min(8).max(12),
  introMessage: z.string().trim().max(LIMITS.INTRO_MESSAGE_MAX).nullish(),
});
export type SendRequestBody = z.infer<typeof sendRequestBody>;

export const blockSchema = z.object({
  id: z.uuid(),
  blockedCode: z.string(),
  blockedDisplayName: z.string(),
  fromCode: z.string(),
  createdAt: z.string(),
});
export type BlockDto = z.infer<typeof blockSchema>;
