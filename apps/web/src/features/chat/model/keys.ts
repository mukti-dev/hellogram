import type { InboxFilter } from '../api/chat.api.js';

export const chatKeys = {
  all: ['conversations'] as const,
  inbox: (filter: InboxFilter) => ['conversations', 'inbox', filter] as const,
  unread: ['conversations', 'unread'] as const,
  one: (id: string) => ['conversations', 'one', id] as const,
  messages: (id: string) => ['conversations', 'messages', id] as const,
};
