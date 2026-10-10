import { ErrorCode, LIMITS, type GifDto, type Retention } from '@hellogram/shared';
import { DomainError } from '../errors/domain-error.js';
import type { Persona } from '../personas/persona.js';
import type { MessageAttachment } from './attachments.js';
import type { VaultState } from '../vault/vault.js';

export type MessageType = 'text' | 'system';
export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface Message {
  id: string;
  conversationId: string;
  senderPersonaId: string;
  clientMessageId: string;
  type: MessageType;
  body: string | null;
  attachment: MessageAttachment | null;
  /** A KLIPY GIF link (validated against the KLIPY media hosts). */
  gif: GifDto | null;
  systemPayload: SystemPayload | null;
  suppressed: boolean;
  createdAt: Date;
  deliveredAt: Date | null;
  readAt: Date | null;
  /** Soft-deleted: hidden from both sides; the content is erased after LIMITS.SOFT_DELETE_DAYS. */
  deletedForEveryoneAt: Date | null;
  /** Past the chat's retention: hidden the same way. */
  expiredAt: Date | null;
  /** Text and file erased for good. */
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
  /** Vault, this side only (null = inbox). */
  vault: VaultState | null;
  vaultSpaceId: string | null;
  /** This side's ringtone for calls in this chat (null = the number's). */
  ringtone: string | null;
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
  /** Which vault folders to include ('inbox' = not in the vault). Default: inbox only. */
  folders?: (VaultState | 'inbox')[] | undefined;
  /** Hidden spaces this device opened (for the 'hidden' folder). */
  spaceIds?: string[] | undefined;
  /** One of the user's own labels (case-insensitive). */
  label?: string | undefined;
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

/** A caption is optional, but follows the same rules as a message when present. */
export function normalizeCaption(input: string | undefined): string | null {
  const caption = (input ?? '').replace(/\r\n/g, '\n').trim();
  if (!caption) return null;
  if (caption.length > LIMITS.ATTACHMENT_CAPTION_MAX) {
    throw new DomainError(ErrorCode.MESSAGE_TOO_LONG, 'Captions can be up to 1,000 characters');
  }
  return caption;
}

/** True while a message's text and file may still be shown. */
export const hasContent = (m: Pick<Message, 'deletedForEveryoneAt' | 'expiredAt' | 'contentPurgedAt'>) =>
  !m.deletedForEveryoneAt && !m.expiredAt && !m.contentPurgedAt;

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

/**
 * Delete for everyone: either person in the chat can remove any message, their own or the other
 * person's, at any time. (Replaces the original rule 19: sender only, within 60 minutes.)
 * System notices (e.g. "disappearing messages turned on") stay.
 */
export function assertCanDeleteForEveryone(message: Pick<Message, 'type'>): void {
  if (message.type !== 'text') throw new DomainError(ErrorCode.FORBIDDEN, 'This message can’t be deleted');
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

/** Photos and files are allowed in a chat only when both numbers allow them. */
export const mediaAllowed = (view: Pick<ConversationView, 'myPersona' | 'otherPersona'>) =>
  view.myPersona.allowMedia && view.otherPersona.allowMedia;

/** True when the conversation is gone for this member (retired number, deleted account). */
export const isClosed = (view: Pick<ConversationView, 'conversation' | 'otherPersona'>) =>
  Boolean(view.conversation.closedAt) || view.otherPersona.status === 'retired';
