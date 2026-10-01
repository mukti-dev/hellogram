import {
  hasContent,
  isClosed,
  mediaAllowed,
  messageStatus,
  type ConversationView,
  type InboxRow,
  type Message,
  type MessageAttachment,
  type Persona,
} from '@hellogram/domain';
import type { AttachmentDto, ChatCounterpartDto, ConversationDto, LockedNumberRowDto, MessageDto } from '@hellogram/shared';
import { toOwnBrief, type AvatarUrl } from '../shared-mappers.js';

/** File details for clients. Where and how it is stored never leaves the server. */
export const toAttachmentDto = (a: MessageAttachment): AttachmentDto => ({
  id: a.id,
  kind: a.kind,
  fileName: a.fileName,
  mimeType: a.mimeType,
  size: a.sizeBytes,
  width: a.width,
  height: a.height,
});

/** A message as seen by `viewerPersonaId`. */
export function toMessageDto(m: Message, viewerPersonaId: string): MessageDto {
  const mine = m.senderPersonaId === viewerPersonaId;
  const deleted = Boolean(m.deletedForEveryoneAt);
  let system: MessageDto['system'] = null;
  if (m.systemPayload?.kind === 'retention_changed') {
    system = { kind: 'retention_changed', byMe: m.systemPayload.byPersonaId === viewerPersonaId, value: m.systemPayload.value };
  } else if (m.systemPayload?.kind === 'number_unavailable') {
    system = { kind: 'number_unavailable' };
  }
  return {
    id: m.id,
    conversationId: m.conversationId,
    clientMessageId: mine ? m.clientMessageId : null,
    mine,
    type: m.type,
    body: deleted ? null : m.body,
    attachment: m.attachment && hasContent(m) ? toAttachmentDto(m.attachment) : null,
    system,
    createdAt: m.createdAt.toISOString(),
    deleted,
    status: mine && m.type === 'text' ? messageStatus(m) : null,
  };
}

export function toChatCounterpart(
  view: Pick<ConversationView, 'me' | 'otherPersona' | 'conversation'>,
  avatarUrl: AvatarUrl,
): ChatCounterpartDto {
  if (view.me.counterpartMasked) {
    // No real persona id either: the conversation id stands in.
    return { id: view.conversation.id, code: null, displayName: 'Unknown', avatarUrl: null, masked: true };
  }
  return {
    id: view.otherPersona.id,
    code: view.otherPersona.code,
    displayName: view.otherPersona.displayName,
    avatarUrl: avatarUrl(view.otherPersona.avatarKey),
    masked: false,
  };
}

export function toConversationDto(
  view: ConversationView & Partial<Pick<InboxRow, 'lastMessage' | 'unread'>>,
  avatarUrl: AvatarUrl,
): ConversationDto {
  const last = view.lastMessage ?? null;
  return {
    id: view.conversation.id,
    me: toOwnBrief(view.myPersona),
    counterpart: toChatCounterpart(view, avatarUrl),
    nickname: view.me.nickname,
    unavailable: isClosed(view),
    retention: view.conversation.retention,
    mutedUntil: view.me.mutedUntil?.toISOString() ?? null,
    mediaAllowed: mediaAllowed(view),
    unread: view.unread ?? 0,
    lastMessage: last ? toMessageDto(last, view.myPersona.id) : null,
    lastActivityAt: (last?.createdAt ?? view.conversation.createdAt).toISOString(),
  };
}

export const toLockedRow = (p: Persona): LockedNumberRowDto => ({
  personaId: p.id,
  displayName: p.displayName,
  labelIcon: p.labelIcon,
  labelName: p.labelName,
});
