import type { Retention } from '@hellogram/shared';
import type { Page } from '../requests/ports.js';
import type { Attachment } from './attachments.js';
import type { ConversationView, InboxFilter, InboxRow, Message, SystemPayload } from './chat.js';

export interface NewMessage {
  conversationId: string;
  senderPersonaId: string;
  clientMessageId: string;
  body: string | null;
  type: 'text' | 'system';
  systemPayload?: SystemPayload | null;
  suppressed: boolean;
  /**
   * An upload to send with this message. It must be the sender's own, from this conversation,
   * and not already sent — otherwise nothing is inserted and `attachmentRejected` comes back.
   */
  attachmentId?: string | null;
}

export type InsertMessageResult = { message: Message; created: boolean } | { attachmentRejected: true };

export type NewAttachment = Omit<Attachment, 'id' | 'messageId' | 'createdAt'>;

export interface AttachmentRepository {
  create(attachment: NewAttachment): Promise<Attachment>;
  findById(id: string): Promise<Attachment | null>;
  delete(id: string): Promise<void>;
  /**
   * Rows whose file must be destroyed: uploads never sent (older than `unsentBefore`),
   * and files whose message was deleted for everyone, expired, or removed.
   */
  listDisposable(unsentBefore: Date, limit: number): Promise<Pick<Attachment, 'id' | 'storageKey'>[]>;
}

/** Private object storage (S3). Never reachable from the internet; only the API reads it. */
export interface BlobStore {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/**
 * Encrypts files before they leave the server. `context` is bound into the ciphertext,
 * so a stored object can't be swapped for another one.
 */
export interface FileCipher {
  seal(plain: Uint8Array, context: string): Uint8Array;
  /** Throws if the data was tampered with, the context differs, or no key fits. */
  open(sealed: Uint8Array, context: string): Uint8Array;
}

export interface ConversationRepository {
  /** The conversation from `personaId`'s side, or null if they aren't a member. */
  findView(conversationId: string, personaId: string): Promise<ConversationView | null>;
  /** Membership lookup across all of an account's personas. */
  findViewForAccount(conversationId: string, personaIds: string[]): Promise<ConversationView | null>;
  listInbox(filter: InboxFilter): Promise<Page<InboxRow>>;
  /** Messages visible to `personaId`, newest first. */
  listMessages(conversationId: string, personaId: string, cursor: string | null, limit: number): Promise<Page<Message>>;
  /** Idempotent on (sender, clientMessageId): returns the existing message on retry. */
  insertMessage(message: NewMessage): Promise<InsertMessageResult>;
  findMessage(id: string): Promise<Message | null>;
  /** The message, only if `personaId` can currently see it (not suppressed for them, cleared or hidden). */
  findVisibleMessage(id: string, personaId: string): Promise<Message | null>;
  /** Marks messages from others as delivered; returns what changed, grouped by sender. */
  markDelivered(readerPersonaId: string, messageIds: string[], at: Date): Promise<{ conversationId: string; senderPersonaId: string; messageIds: string[] }[]>;
  /** Updates the reader's read pointer; stamps readAt only when `stampReadAt` (read receipts on). */
  markRead(conversationId: string, readerPersonaId: string, upToMessageId: string, stampReadAt: boolean, at: Date): Promise<{ changed: boolean }>;
  hideMessage(messageId: string, personaId: string): Promise<void>;
  deleteForEveryone(messageId: string, at: Date): Promise<void>;
  updateMember(conversationId: string, personaId: string, patch: { nickname?: string | null; mutedUntil?: Date | null; clearedBefore?: Date }): Promise<void>;
  setRetention(conversationId: string, retention: Retention, byPersonaId: string, at: Date): Promise<void>;
  /** Block effects (§6.3): hide for the blocker, mask the blocker for the blocked side. */
  applyBlock(conversationId: string, blockerPersonaId: string, blockedPersonaId: string, at: Date): Promise<void>;
  removeBlock(conversationId: string): Promise<void>;
  /** Unread chats across personas, for the nav badge. */
  countUnreadConversations(personaIds: string[]): Promise<number>;
}
