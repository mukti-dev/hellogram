import type { MessageDto, UpdateConversationBody } from '@hellogram/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chatApi, type InboxFilter } from '../api/chat.api.js';
import { forgetAttachment } from './attachments.js';
import { updateMessages, upsertMessage } from './cache.js';
import { chatKeys } from './keys.js';

export const useInbox = (filter: InboxFilter) =>
  useInfiniteQuery({
    queryKey: chatKeys.inbox(filter),
    queryFn: ({ pageParam }) => chatApi.inbox(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useUnreadChatCount = () =>
  useQuery({ queryKey: chatKeys.unread, queryFn: chatApi.unreadCount, select: (d) => d.count });

export const useConversation = (id: string) =>
  useQuery({ queryKey: chatKeys.one(id), queryFn: () => chatApi.get(id), retry: false });

export const useMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: chatKeys.messages(id),
    queryFn: ({ pageParam }) => chatApi.messages(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export function useUpdateConversation(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateConversationBody) => chatApi.update(id, body),
    onSuccess: (conversation) => {
      client.setQueryData(chatKeys.one(id), conversation);
      void client.invalidateQueries({ queryKey: ['conversations', 'inbox'] });
      void client.invalidateQueries({ queryKey: chatKeys.messages(id) });
    },
  });
}

export function useClearChat(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => chatApi.clear(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: chatKeys.messages(id) });
      void client.invalidateQueries({ queryKey: ['conversations', 'inbox'] });
    },
  });
}

export function useDeleteMessage(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ message, scope }: { message: MessageDto; scope: 'me' | 'everyone' }) =>
      chatApi.deleteMessage(message.id, scope),
    onSuccess: (_void, { message, scope }) => {
      if (message.attachment) forgetAttachment(message.attachment.id);
      if (scope === 'everyone') {
        upsertMessage(client, { ...message, deleted: true, body: null, attachment: null, gif: null, replyTo: null });
        updateMessages(client, conversationId, (m) =>
          m.replyTo?.id === message.id ? { ...m, replyTo: { ...m.replyTo, text: null, available: false } } : m,
        );
      } else void client.invalidateQueries({ queryKey: chatKeys.messages(conversationId) });
      void client.invalidateQueries({ queryKey: ['conversations', 'inbox'] });
    },
  });
}
