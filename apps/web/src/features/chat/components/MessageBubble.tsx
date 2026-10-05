import type { MessageDto } from '@hellogram/shared';
import { DropdownMenu, cn } from '@hellogram/ui';
import { ChevronDown, Copy, Trash2 } from 'lucide-react';
import { t } from '../../../i18n/t.js';
import { clockTime } from '../../../shared/format.js';
import { useDeleteMessage } from '../model/queries.js';
import { AttachmentView, GifView } from './AttachmentView.js';
import { Ticks, type TickState } from './Ticks.js';

const PERIOD: Record<string, string> = { d90: '90 days', d30: '30 days', d7: '7 days', h24: '24 hours' };

export function systemText(m: MessageDto, otherName: string): string {
  if (m.system?.kind === 'retention_changed') {
    if (m.system.value === 'forever') {
      return m.system.byMe ? t('chat.youOffRetention') : t('chat.theyOffRetention', { name: otherName });
    }
    const period = PERIOD[m.system.value] ?? m.system.value;
    return m.system.byMe ? t('chat.youSetRetention', { period }) : t('chat.theySetRetention', { name: otherName, period });
  }
  return t('chat.numberGone');
}

export function MessageBubble({
  message,
  otherName,
  tick,
  onRetry,
}: {
  message: MessageDto;
  otherName: string;
  /** Overrides the tick for optimistic (outbox) messages. */
  tick?: TickState;
  onRetry?: () => void;
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
    <div className={cn('group flex items-end gap-1', mine ? 'justify-end' : 'justify-start')}>
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
