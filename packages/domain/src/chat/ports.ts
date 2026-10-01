import type { Retention } from '@hellogram/shared';
import type { Page } from '../requests/ports.js';
import type { ConversationView, InboxFilter, InboxRow, Message, SystemPayload } from './chat.js';

export interface NewMessage {
  conversationId: string;
  senderPersonaId: string;
  clientMessageId: string;
  body: string | null;
  type: 'text' | 'system';
  systemPayload?: SystemPayload | null;
  suppressed: boolean;
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
  insertMessage(message: NewMessage): Promise<{ message: Message; created: boolean }>;
  findMessage(id: string): Promise<Message | null>;
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
