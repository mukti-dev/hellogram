import { LIMITS, type MessageDto, type ReplyPreviewDto } from '@hellogram/shared';
import { t } from '../../../i18n/t.js';

/** The quote for a reply to `m`, built on this device (for the reply bar and unsent replies). */
export function quoteOf(m: MessageDto): ReplyPreviewDto {
  const kind: ReplyPreviewDto['kind'] = m.attachment ? m.attachment.kind : m.gif ? 'gif' : 'text';
  const raw = m.body?.trim() ? m.body : m.attachment?.kind === 'file' ? m.attachment.fileName : null;
  const text = raw && raw.length > LIMITS.REPLY_PREVIEW_MAX ? `${raw.slice(0, LIMITS.REPLY_PREVIEW_MAX - 1)}…` : raw;
  return { id: m.id, mine: m.mine, kind, text, available: !m.deleted };
}

/** Can this message be replied to? (Not system notices, deleted or unsent ones.) */
export const canReplyTo = (m: MessageDto) => m.type === 'text' && !m.deleted;

const KIND_LABEL = {
  image: 'chat.photo',
  voice: 'chat.voiceMessage',
  sticker: 'chat.sticker',
  gif: 'chat.gif',
  file: 'chat.file',
} as const;

/** The line shown in a quote: the text, else what kind of message it was. */
export function quoteText(q: ReplyPreviewDto): string {
  if (!q.available) return t('chat.replyUnavailable');
  if (q.text) return q.text;
  return q.kind === 'text' ? '' : t(KIND_LABEL[q.kind]);
}

export const quoteAuthor = (q: Pick<ReplyPreviewDto, 'mine'>, otherName: string) => (q.mine ? t('chat.you') : otherName);
