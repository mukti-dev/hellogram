import {
  hasContent,
  isClosed,
  mediaAllowed,
  messageStatus,
  toReplyPreview,
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
  durationMs: a.durationMs,
  waveform: a.waveform,
});

/** A message as seen by `viewerPersonaId`. */
export function toMessageDto(m: Message, viewerPersonaId: string): MessageDto {
  const mine = m.senderPersonaId === viewerPersonaId;
  // Deleted and expired messages keep their content on the server for 30 days; clients never get it.
  const deleted = Boolean(m.deletedForEveryoneAt);
  let system: MessageDto['system'] = null;
  if (m.systemPayload?.kind === 'retention_changed') {
    system = {
      kind: 'retention_changed',
      byMe: m.systemPayload.byPersonaId === viewerPersonaId,
      value: m.systemPayload.value,
      minutes: m.systemPayload.minutes ?? null,
    };
  } else if (m.systemPayload?.kind === 'number_unavailable') {
    system = { kind: 'number_unavailable' };
  }
  return {
    id: m.id,
    conversationId: m.conversationId,
    clientMessageId: mine ? m.clientMessageId : null,
    mine,
    type: m.type,
    body: hasContent(m) ? m.body : null,
    attachment: m.attachment && hasContent(m) ? toAttachmentDto(m.attachment) : null,
    gif: m.gif && hasContent(m) ? m.gif : null,
    system,
    replyTo: m.replyTo && hasContent(m) ? toReplyPreview(m.replyTo, viewerPersonaId) : null,
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
    retentionMinutes: view.conversation.retention === 'custom' ? view.conversation.retentionMinutes : null,
    mutedUntil: view.me.mutedUntil?.toISOString() ?? null,
    mediaAllowed: mediaAllowed(view),
    unread: view.unread ?? 0,
    lastMessage: last ? toMessageDto(last, view.myPersona.id) : null,
    lastActivityAt: (last?.createdAt ?? view.conversation.createdAt).toISOString(),
    vault: view.me.vault,
  };
}

export const toLockedRow = (p: Persona): LockedNumberRowDto => ({
  personaId: p.id,
  displayName: p.displayName,
  labelIcon: p.labelIcon,
  labelName: p.labelName,
});
