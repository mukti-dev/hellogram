import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { labelKindSchema, retentionSchema } from './personas.js';
import { ownPersonaBriefSchema } from './requests.js';

export const systemEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('retention_changed'), byMe: z.boolean(), value: retentionSchema }),
  z.object({ kind: z.literal('number_unavailable') }),
]);

export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  /** Only set on my own messages (lets the offline queue match its optimistic copy). */
  clientMessageId: z.string().nullable(),
  mine: z.boolean(),
  type: z.enum(['text', 'system']),
  body: z.string().nullable(),
  system: systemEventSchema.nullable(),
  createdAt: z.string(),
  deleted: z.boolean(),
  /** Ticks, only on my own messages. */
  status: z.enum(['sent', 'delivered', 'read']).nullable(),
});
export type MessageDto = z.infer<typeof messageSchema>;

/** The other side of a chat. Masked = "Unknown" (the other person blocked you). */
export const chatCounterpartSchema = z.object({
  id: z.uuid(),
  code: z.string().nullable(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  masked: z.boolean(),
});
export type ChatCounterpartDto = z.infer<typeof chatCounterpartSchema>;

export const conversationSchema = z.object({
  id: z.uuid(),
  me: ownPersonaBriefSchema,
  counterpart: chatCounterpartSchema,
  /** Private name I gave this chat (never sent to the other side). */
  nickname: z.string().nullable(),
  /** "This number is no longer available". */
  unavailable: z.boolean(),
  retention: retentionSchema,
  mutedUntil: z.string().nullable(),
  unread: z.number().int(),
  lastMessage: messageSchema.nullable(),
  lastActivityAt: z.string(),
});
export type ConversationDto = z.infer<typeof conversationSchema>;

export const lockedNumberRowSchema = z.object({
  personaId: z.uuid(),
  displayName: z.string(),
  labelKind: labelKindSchema,
  labelText: z.string().nullable(),
});
export type LockedNumberRowDto = z.infer<typeof lockedNumberRowSchema>;

export const inboxSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
  locked: z.array(lockedNumberRowSchema),
});
export type InboxDto = z.infer<typeof inboxSchema>;

export const messagePageSchema = z.object({ items: z.array(messageSchema), nextCursor: z.string().nullable() });
export type MessagePageDto = z.infer<typeof messagePageSchema>;

export const sendMessageBody = z.object({
  clientMessageId: z.string().min(8).max(64),
  body: z.string().min(1).max(LIMITS.MESSAGE_MAX + 100),
});
export type SendMessageBody = z.infer<typeof sendMessageBody>;

export const updateConversationBody = z
  .object({
    nickname: z.string().max(LIMITS.NICKNAME_MAX + 20).nullable(),
    mutedUntil: z.iso.datetime().nullable(),
    retention: retentionSchema,
  })
  .partial();
export type UpdateConversationBody = z.infer<typeof updateConversationBody>;
