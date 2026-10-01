import { ErrorCode, LIMITS, type LabelKind, type Retention } from '@hellogram/shared';
import { DomainError } from '../errors/domain-error.js';
import type { Persona } from '../personas/persona.js';

export type MessageType = 'text' | 'system';
export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface Message {
  id: string;
  conversationId: string;
  senderPersonaId: string;
  clientMessageId: string;
  type: MessageType;
  body: string | null;
  systemPayload: SystemPayload | null;
  suppressed: boolean;
  createdAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  deletedForEveryoneAt: Date | null;
  contentPurgedAt: Date | null;
}

export type SystemPayload =
  | { kind: 'retention_changed'; byPersonaId: string; value: Retention }
  | { kind: 'number_unavailable' };

export interface ConversationMember {
  personaId: string;
  nickname: string | null;
  clearedBefore: Date | null;
  mutedUntil: Date | null;
  lastReadMessageId: string | null;
  hiddenAt: Date | null;
  counterpartMasked: boolean;
}

export interface Conversation {
  id: string;
  retention: Retention;
  retentionChangedById: string | null;
  retentionChangedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  closedAt: Date | null;
}

/** A conversation seen from one member's side. */
export interface ConversationView {
  conversation: Conversation;
  me: ConversationMember;
  myPersona: Persona;
  other: ConversationMember;
  otherPersona: Persona;
}

export interface InboxRow extends ConversationView {
  lastMessage: Message | null;
  unread: number;
}

export interface InboxFilter {
  personaIds: string[];
  labelKind?: LabelKind | undefined;
  unreadOnly?: boolean | undefined;
  query?: string | undefined;
  cursor?: string | null | undefined;
  limit: number;
}

export function normalizeMessageBody(input: string): string {
  const body = input.replace(/\r\n/g, '\n').trim();
  if (!body) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Message can’t be empty');
  if (body.length > LIMITS.MESSAGE_MAX) {
    throw new DomainError(ErrorCode.MESSAGE_TOO_LONG, 'Messages can be up to 4,000 characters');
  }
  return body;
}

export function normalizeNickname(input: string | null): string | null {
  if (input === null) return null;
  // Strip control characters; keep emoji.
  const clean = input.replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length > LIMITS.NICKNAME_MAX) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Names can be up to 40 characters');
  }
  return clean;
}

/** Rule 19: delete for everyone — sender only, within 60 minutes. */
export function assertCanDeleteForEveryone(message: Message, actorPersonaId: string, now: Date): void {
  if (message.senderPersonaId !== actorPersonaId || message.type !== 'text') {
    throw new DomainError(ErrorCode.FORBIDDEN, 'You can only delete your own messages for everyone');
  }
  if (now.getTime() - message.createdAt.getTime() > LIMITS.DELETE_FOR_EVERYONE_WINDOW_MIN * 60_000) {
    throw new DomainError(ErrorCode.DELETE_WINDOW_EXPIRED, 'Messages can be deleted for everyone within 60 minutes');
  }
}

/** Tick shown to the sender. Suppressed (blocked) messages stay at one tick forever. */
export function messageStatus(m: Pick<Message, 'deliveredAt' | 'readAt'>): MessageStatus {
  if (m.readAt) return 'read';
  if (m.deliveredAt) return 'delivered';
  return 'sent';
}

const HOUR = 60 * 60 * 1000;
export const RETENTION_MS: Record<Retention, number | null> = {
  forever: null,
  d90: 90 * 24 * HOUR,
  d30: 30 * 24 * HOUR,
  d7: 7 * 24 * HOUR,
  h24: 24 * HOUR,
};

/** True when the conversation is gone for this member (retired number, deleted account). */
export const isClosed = (view: Pick<ConversationView, 'conversation' | 'otherPersona'>) =>
  Boolean(view.conversation.closedAt) || view.otherPersona.status === 'retired';
