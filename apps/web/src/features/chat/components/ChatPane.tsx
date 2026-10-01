import type { ConversationDto, MessageDto } from '@hellogram/shared';
import { Clock } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { getSocket } from '../../../core/realtime/socket.js';
import { t } from '../../../i18n/t.js';
import { dayLabel } from '../../../shared/format.js';
import { chatApi } from '../api/chat.api.js';
import { useOutbox } from '../model/outbox.js';
import { useMessages } from '../model/queries.js';
import { useRetryMessage } from '../model/send.js';
import { Composer } from './Composer.js';
import { MessageBubble } from './MessageBubble.js';

const PERIOD: Record<string, string> = { d90: '90 days', d30: '30 days', d7: '7 days', h24: '24 hours' };

export function ChatPane({ conversation }: { conversation: ConversationDto }) {
  const messages = useMessages(conversation.id);
  const outbox = useOutbox((s) => s.items);
  const retry = useRetryMessage();
  const olderRef = useRef<HTMLDivElement>(null);
  const otherName = conversation.nickname ?? conversation.counterpart.displayName;

  const server = useMemo(() => messages.data?.pages.flatMap((p) => p.items) ?? [], [messages.data]);
  const pending = outbox
    .filter((o) => o.conversationId === conversation.id)
    .filter((o) => !server.some((m) => m.clientMessageId === o.clientMessageId))
    .reverse();

  // ✓✓ for anything fetched over HTTP that this device hasn't acknowledged yet.
  useEffect(() => {
    const ids = server.filter((m) => !m.mine && m.type === 'text').slice(0, 50).map((m) => m.id);
    if (ids.length) void chatApi.ack(ids).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.data?.pages[0]?.items[0]?.id]);

  // Read receipt for the newest message from the other side while the chat is open.
  const newestTheirsId = server.find((m) => !m.mine)?.id;
  useEffect(() => {
    if (!newestTheirsId || document.visibilityState !== 'visible') return;
    const socket = getSocket();
    if (socket?.connected) socket.emit('message:read', { conversationId: conversation.id, upToMessageId: newestTheirsId });
    else void chatApi.read(conversation.id, newestTheirsId).catch(() => undefined);
  }, [conversation.id, newestTheirsId]);

  // Load older messages when the top sentinel scrolls into view.
  useEffect(() => {
    const el = olderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [messages]);

  // Newest first; the column is reversed so the view stays pinned to the bottom.
  const rows: { m: MessageDto; tick?: 'pending' | 'failed'; retry?: () => void }[] = [
    ...pending.map((o) => ({
      m: {
        id: o.clientMessageId,
        conversationId: o.conversationId,
        clientMessageId: o.clientMessageId,
        mine: true,
        type: 'text' as const,
        body: o.body,
        attachment: null,
        system: null,
        createdAt: o.createdAt,
        deleted: false,
        status: null,
      },
      tick: o.state === 'failed' ? ('failed' as const) : ('pending' as const),
      retry: () => void retry(o),
    })),
    ...server.map((m) => ({ m })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {conversation.retention !== 'forever' && (
        <div className="flex justify-center px-4 pt-3">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-muted">
            <Clock className="size-3.5" aria-hidden />
            {t('chat.disappears', { period: PERIOD[conversation.retention] ?? '' })}
          </span>
        </div>
      )}
      <div className="flex flex-1 flex-col-reverse gap-1.5 overflow-y-auto px-3 py-3 lg:px-6" role="log" aria-label="Messages">
        {rows.map(({ m, tick, retry: onRetry }, i) => {
          const older = rows[i + 1]?.m;
          const newDay = !older || dayLabel(older.createdAt) !== dayLabel(m.createdAt);
          return (
            <Fragment key={m.id}>
              <MessageBubble message={m} otherName={otherName} tick={tick} onRetry={onRetry} />
              {newDay && (
                <div className="my-2 flex justify-center">
                  <span className="text-[11px] font-medium text-muted">{dayLabel(m.createdAt)}</span>
                </div>
              )}
            </Fragment>
          );
        })}
        <div ref={olderRef} className="h-4 shrink-0">
          {messages.isFetchingNextPage && <p className="text-center text-xs text-muted">{t('chat.loadOlder')}</p>}
        </div>
      </div>
      {conversation.unavailable ? (
        <p className="border-t border-border bg-surface-1 p-4 text-center text-sm text-muted">{t('chat.unavailable')}</p>
      ) : (
        <Composer conversationId={conversation.id} mediaAllowed={conversation.mediaAllowed} />
      )}
    </div>
  );
}
