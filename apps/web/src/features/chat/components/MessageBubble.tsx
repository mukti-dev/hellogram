import type { MessageDto, ReplyPreviewDto } from '@hellogram/shared';
import { DropdownMenu, cn } from '@hellogram/ui';
import { ChevronDown, Copy, Reply, Trash2 } from 'lucide-react';
import { t } from '../../../i18n/t.js';
import { clockTime } from '../../../shared/format.js';
import { useDeleteMessage } from '../model/queries.js';
import { canReplyTo, quoteAuthor, quoteText } from '../model/reply.js';
import { retentionPeriod } from '../model/retention.js';
import { AttachmentView, GifView } from './AttachmentView.js';
import { Ticks, type TickState } from './Ticks.js';

export function systemText(m: MessageDto, otherName: string): string {
  if (m.system?.kind === 'retention_changed') {
    if (m.system.value === 'forever') {
      return m.system.byMe ? t('chat.youOffRetention') : t('chat.theyOffRetention', { name: otherName });
    }
    const period = retentionPeriod(m.system.value, m.system.minutes) ?? m.system.value;
    return m.system.byMe ? t('chat.youSetRetention', { period }) : t('chat.theySetRetention', { name: otherName, period });
  }
  return t('chat.numberGone');
}

/** The quoted message inside a reply bubble. Clicking it jumps to the original. */
function Quote({ quote, otherName, mine, onJump }: { quote: ReplyPreviewDto; otherName: string; mine: boolean; onJump?: ((id: string) => void) | undefined }) {
  const text = quoteText(quote);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJump?.(quote.id);
      }}
      disabled={!quote.available}
      className={cn(
        'mb-1 block w-full min-w-0 rounded-lg border-l-4 px-2.5 py-1 text-left text-[13px] leading-snug',
        mine ? 'border-white/70 bg-white/15' : 'border-primary bg-surface-1/70',
        quote.available ? 'cursor-pointer' : 'cursor-default',
      )}
    >
      <span className={cn('block truncate text-xs font-semibold', mine ? 'text-white' : 'text-primary')}>{quoteAuthor(quote, otherName)}</span>
      <span className={cn('line-clamp-2 break-words', !quote.available && 'italic', mine ? 'text-white/85' : 'text-muted')}>{text}</span>
    </button>
  );
}

export function MessageBubble({
  message,
  otherName,
  tick,
  onRetry,
  onReply,
  onJump,
  highlighted,
}: {
  message: MessageDto;
  otherName: string;
  /** Overrides the tick for optimistic (outbox) messages. */
  tick?: TickState;
  onRetry?: (() => void) | undefined;
  onReply?: ((message: MessageDto) => void) | undefined;
  /** Scroll to a quoted message. */
  onJump?: ((messageId: string) => void) | undefined;
  /** Briefly lit after jumping to it from a quote. */
  highlighted?: boolean | undefined;
}) {
  const remove = useDeleteMessage(message.conversationId);

  if (message.type === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-md bg-surface-2 px-3 py-1.5 text-center text-xs text-muted">{systemText(message, otherName)}</span>
      </div>
    );
  }

  const mine = message.mine;
  // Stickers stand on their own, without a bubble.
  const sticker = message.attachment?.kind === 'sticker' && !message.deleted;
  const state: TickState | null = tick ?? (mine && message.status ? message.status : null);
  const isOptimistic = Boolean(tick);

  return (
    <div
      data-message-id={message.id}
      className={cn('group flex items-end gap-1 rounded-xl transition-colors duration-700', mine ? 'justify-end' : 'justify-start', highlighted && 'bg-primary/15')}
    >
      <div
        className={cn(
          'relative max-w-[78%] rounded-2xl text-[15px] leading-snug',
          sticker ? 'text-fg' : 'shadow-sm',
          message.attachment || message.gif ? 'p-1.5' : 'px-3.5 py-2',
          !sticker && (mine ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-surface-2 text-fg'),
          message.deleted && 'italic opacity-80',
          tick === 'failed' && 'cursor-pointer ring-1 ring-danger',
        )}
        onClick={tick === 'failed' ? onRetry : undefined}
      >
        {message.replyTo && !message.deleted && (
          <div className={cn((message.attachment || message.gif) && 'px-0.5 pt-0.5')}>
            <Quote quote={message.replyTo} otherName={otherName} mine={mine && !sticker} onJump={onJump} />
          </div>
        )}
        {message.attachment && <AttachmentView attachment={message.attachment} mine={mine} />}
        {message.gif && <GifView gif={message.gif} />}
        {(message.deleted || message.body || (!message.attachment && !message.gif)) && (
          <p className={cn('break-words whitespace-pre-wrap', (message.attachment || message.gif) && 'px-2 pt-1.5')}>
            {message.deleted ? t('chat.deleted') : message.body}
          </p>
        )}
        <span className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', (message.attachment || message.gif) && 'px-2 pb-0.5', mine && !sticker ? 'text-white/75' : 'text-muted')}>
          {tick === 'failed' ? t('chat.notSent') : tick === 'pending' && !navigator.onLine ? t('chat.queued') : clockTime(message.createdAt)}
          {state && <Ticks state={state} />}
        </span>
        {!isOptimistic && !message.deleted && (
          <span className={cn('absolute top-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100', mine ? '-left-8' : '-right-8')}>
            <DropdownMenu
              align={mine ? 'end' : 'start'}
              trigger={
                <button
                  type="button"
                  aria-label={t('chat.messageActions')}
                  className="inline-flex size-7 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-fg"
                >
                  <ChevronDown className="size-4" aria-hidden />
                </button>
              }
              items={[
                ...(onReply && canReplyTo(message)
                  ? [{ label: t('chat.reply'), icon: <Reply className="size-4" />, onSelect: () => onReply(message), movesFocus: true }]
                  : []),
                ...(message.body
                  ? [{ label: t('chat.copy'), icon: <Copy className="size-4" />, onSelect: () => void navigator.clipboard?.writeText(message.body ?? '') }]
                  : []),
                { label: t('chat.deleteForMe'), icon: <Trash2 className="size-4" />, onSelect: () => remove.mutate({ message, scope: 'me' }) },
                // Any message, mine or theirs, at any time.
                { label: t('chat.deleteForEveryone'), icon: <Trash2 className="size-4" />, danger: true, onSelect: () => remove.mutate({ message, scope: 'everyone' }) },
              ]}
            />
          </span>
        )}
      </div>
    </div>
  );
}
