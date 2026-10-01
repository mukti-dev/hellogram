import type { MessageDto } from '@hellogram/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../core/http/api-error.js';
import { chatApi } from '../api/chat.api.js';
import { upsertMessage } from './cache.js';
import { newClientMessageId, useOutbox, type OutboxItem } from './outbox.js';

async function deliver(client: QueryClient, item: OutboxItem): Promise<void> {
  const outbox = useOutbox.getState();
  outbox.update(item.clientMessageId, { state: 'sending', error: undefined });
  try {
    const message: MessageDto = await chatApi.send(item.conversationId, item.clientMessageId, item.body);
    upsertMessage(client, message);
    outbox.remove(item.clientMessageId);
    void client.invalidateQueries({ queryKey: ['conversations', 'inbox'] });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
      outbox.update(item.clientMessageId, { state: 'queued' });
    } else {
      outbox.update(item.clientMessageId, {
        state: 'failed',
        error: error instanceof Error ? error.message : 'Not sent',
      });
    }
  }
}

export function useSendMessage(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const item: OutboxItem = {
        clientMessageId: newClientMessageId(),
        conversationId,
        body,
        createdAt: new Date().toISOString(),
        state: 'sending',
      };
      useOutbox.getState().add(item);
      await deliver(client, item);
    },
  });
}

export function useRetryMessage() {
  const client = useQueryClient();
  return (item: OutboxItem) => deliver(client, item);
}

let flushing = false;
/** Re-sends queued messages in order (on reconnect / back online / app start). */
export async function flushOutbox(client: QueryClient): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of useOutbox.getState().items.filter((i) => i.state !== 'failed')) {
      await deliver(client, item);
      if (useOutbox.getState().items.some((i) => i.clientMessageId === item.clientMessageId && i.state === 'queued')) break;
    }
  } finally {
    flushing = false;
  }
}
