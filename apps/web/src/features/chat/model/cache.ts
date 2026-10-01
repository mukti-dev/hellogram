import type { MessageDto, MessagePageDto } from '@hellogram/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { chatKeys } from './keys.js';

type Pages = InfiniteData<MessagePageDto, string | undefined>;

/** Inserts or replaces a message in a conversation's cached pages (newest first). */
export function upsertMessage(client: QueryClient, message: MessageDto): void {
  client.setQueryData<Pages>(chatKeys.messages(message.conversationId), (data) => {
    if (!data) return data;
    const exists = data.pages.some((p) => p.items.some((m) => m.id === message.id));
    if (exists) {
      return mapMessages(data, (m) => (m.id === message.id ? message : m));
    }
    const [first, ...rest] = data.pages;
    if (!first) return data;
    return { ...data, pages: [{ ...first, items: [message, ...first.items] }, ...rest] };
  });
}

export function mapMessages(data: Pages, fn: (m: MessageDto) => MessageDto | null): Pages {
  return {
    ...data,
    pages: data.pages.map((p) => ({ ...p, items: p.items.map(fn).filter((m): m is MessageDto => m !== null) })),
  };
}

export function updateMessages(client: QueryClient, conversationId: string, fn: (m: MessageDto) => MessageDto | null): void {
  client.setQueryData<Pages>(chatKeys.messages(conversationId), (data) => (data ? mapMessages(data, fn) : data));
}

/** Upgrades my messages' ticks; never downgrades (read > delivered > sent). */
const rank = { sent: 0, delivered: 1, read: 2 } as const;
export function bumpStatus(m: MessageDto, status: 'delivered' | 'read'): MessageDto {
  if (!m.mine || !m.status) return m;
  return rank[status] > rank[m.status] ? { ...m, status } : m;
}
