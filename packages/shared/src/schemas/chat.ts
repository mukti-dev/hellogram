import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { labelIconSchema, retentionSchema } from './personas.js';
import { ownPersonaBriefSchema } from './requests.js';

export const systemEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('retention_changed'), byMe: z.boolean(), value: retentionSchema }),
  z.object({ kind: z.literal('number_unavailable') }),
]);

/** A file or image on a message. The bytes are only ever served by `GET /v1/attachments/:id`. */
export const attachmentSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['image', 'file']),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  /** Pixels, images only (lets the chat reserve space before the image loads). */
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type AttachmentDto = z.infer<typeof attachmentSchema>;

export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  /** Only set on my own messages (lets the offline queue match its optimistic copy). */
  clientMessageId: z.string().nullable(),
  mine: z.boolean(),
  type: z.enum(['text', 'system']),
  body: z.string().nullable(),
  /** Null once the message is deleted or its content has expired. */
  attachment: attachmentSchema.nullable(),
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
  /** Photos and files are allowed only when both numbers allow them. */
  mediaAllowed: z.boolean(),
  unread: z.number().int(),
  lastMessage: messageSchema.nullable(),
  lastActivityAt: z.string(),
});
export type ConversationDto = z.infer<typeof conversationSchema>;

export const lockedNumberRowSchema = z.object({
  personaId: z.uuid(),
  displayName: z.string(),
  labelIcon: labelIconSchema,
  labelName: z.string(),
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

export const sendMessageBody = z
  .object({
    clientMessageId: z.string().min(8).max(64),
    /** Text, or the caption when there's an attachment. */
    body: z.string().max(LIMITS.MESSAGE_MAX + 100).optional(),
    /** From `POST /v1/conversations/:id/attachments`. */
    attachmentId: z.uuid().optional(),
  })
  .refine((v) => Boolean(v.body?.trim()) || Boolean(v.attachmentId), { message: 'Message can’t be empty', path: ['body'] });
export type SendMessageBody = z.infer<typeof sendMessageBody>;

export const updateConversationBody = z
  .object({
    nickname: z.string().max(LIMITS.NICKNAME_MAX + 20).nullable(),
    mutedUntil: z.iso.datetime().nullable(),
    retention: retentionSchema,
  })
  .partial();
export type UpdateConversationBody = z.infer<typeof updateConversationBody>;
