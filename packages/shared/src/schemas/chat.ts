import { z } from 'zod';
import { CHAT_RETENTION_OPTIONS, LIMITS } from '../constants.js';
import { labelIconSchema } from './personas.js';
import { ownPersonaBriefSchema } from './requests.js';

/** How long a chat keeps messages: a preset, or "custom" with `retentionMinutes`. */
export const chatRetentionSchema = z.enum(CHAT_RETENTION_OPTIONS);

export const retentionMinutesSchema = z.number().int().min(LIMITS.CUSTOM_RETENTION_MIN_MINUTES).max(LIMITS.CUSTOM_RETENTION_MAX_MINUTES);

export const systemEventSchema = z.discriminatedUnion('kind', [
  /** `minutes` is set only for "custom". */
  z.object({ kind: z.literal('retention_changed'), byMe: z.boolean(), value: chatRetentionSchema, minutes: z.number().int().nullable() }),
  z.object({ kind: z.literal('number_unavailable') }),
]);

/** A file or image on a message. The bytes are only ever served by `GET /v1/attachments/:id`. */
export const attachmentSchema = z.object({
  id: z.uuid(),
  /** voice: a recorded voice message; sticker: shown without a bubble. GIFs are images (image/gif). */
  kind: z.enum(['image', 'file', 'voice', 'sticker']),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  /** Pixels, images only (lets the chat reserve space before the image loads). */
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Voice messages: length and the loudness outline (0–31 per bar) to draw. */
  durationMs: z.number().int().nullable(),
  waveform: z.array(z.number().int()).nullable(),
});
export type AttachmentDto = z.infer<typeof attachmentSchema>;

/** Where KLIPY serves GIFs; only links to these hosts are accepted. */
export const GIF_HOSTS = ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'] as const;

/**
 * A GIF from KLIPY's search. Shown by loading `url` straight from KLIPY (their terms): Hellogram
 * keeps only the link, which is erased with the message like any other content.
 */
export const gifSchema = z.object({
  provider: z.literal('klipy'),
  slug: z.string().min(1).max(200),
  url: z.url({ protocol: /^https$/, hostname: new RegExp(`^(${GIF_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|')})$`) }).max(600),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
});
export type GifDto = z.infer<typeof gifSchema>;

/**
 * The message a reply points to, as a short quote. `available: false` once that message is deleted
 * or its content has expired (then `text` is null and the quote says so).
 */
export const replyPreviewSchema = z.object({
  id: z.uuid(),
  mine: z.boolean(),
  kind: z.enum(['text', 'image', 'file', 'voice', 'sticker', 'gif']),
  /** The text (cut to REPLY_PREVIEW_MAX), or a file's name / photo caption; null when there's none. */
  text: z.string().nullable(),
  available: z.boolean(),
});
export type ReplyPreviewDto = z.infer<typeof replyPreviewSchema>;

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
  /** Null once the message is deleted or its content has expired. */
  gif: gifSchema.nullable(),
  system: systemEventSchema.nullable(),
  /** The message this one replies to (same chat). */
  replyTo: replyPreviewSchema.nullable(),
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

/** Where a chat sits for me: the normal inbox (null) or the vault. */
export const vaultStateSchema = z.enum(['archived', 'locked', 'hidden']);
export type VaultState = z.infer<typeof vaultStateSchema>;

export const conversationSchema = z.object({
  id: z.uuid(),
  me: ownPersonaBriefSchema,
  counterpart: chatCounterpartSchema,
  /** Private name I gave this chat (never sent to the other side). */
  nickname: z.string().nullable(),
  /** "This number is no longer available". */
  unavailable: z.boolean(),
  retention: chatRetentionSchema,
  /** Only for retention "custom": how many minutes messages are kept. */
  retentionMinutes: z.number().int().nullable(),
  mutedUntil: z.string().nullable(),
  /** Photos and files are allowed only when both numbers allow them. */
  mediaAllowed: z.boolean(),
  unread: z.number().int(),
  lastMessage: messageSchema.nullable(),
  lastActivityAt: z.string(),
  vault: vaultStateSchema.nullable(),
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
    /** A GIF picked from KLIPY (instead of text or a file). */
    gif: gifSchema.optional(),
    /** Reply to this message (must be in the same chat and still have its content). */
    replyToId: z.uuid().optional(),
  })
  .refine((v) => Boolean(v.body?.trim()) || Boolean(v.attachmentId) || Boolean(v.gif), { message: 'Message can’t be empty', path: ['body'] })
  .refine((v) => !(v.gif && v.attachmentId), { message: 'Send a GIF or a file, not both', path: ['gif'] });
export type SendMessageBody = z.infer<typeof sendMessageBody>;

export const updateConversationBody = z
  .object({
    nickname: z.string().max(LIMITS.NICKNAME_MAX + 20).nullable(),
    mutedUntil: z.iso.datetime().nullable(),
    retention: chatRetentionSchema,
    /** Required with retention "custom", ignored otherwise. */
    retentionMinutes: retentionMinutesSchema,
  })
  .partial()
  .refine((v) => v.retention !== 'custom' || v.retentionMinutes !== undefined, {
    message: 'Choose how long to keep messages',
    path: ['retentionMinutes'],
  });
export type UpdateConversationBody = z.infer<typeof updateConversationBody>;
