import type { MessageDto, ReplyPreviewDto } from '@hellogram/shared';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../core/http/api-error.js';
import { t } from '../../../i18n/t.js';
import { chatApi } from '../api/chat.api.js';
import { prepareFile, seedAttachment, tooLarge } from './attachments.js';
import { upsertMessage } from './cache.js';
import { newClientMessageId, useOutbox, type OutboxItem } from './outbox.js';

async function deliver(client: QueryClient, item: OutboxItem): Promise<void> {
  const outbox = useOutbox.getState();
  outbox.update(item.clientMessageId, { state: 'sending', error: undefined });
  try {
    const message: MessageDto = await chatApi.send(
      item.conversationId,
      item.clientMessageId,
      item.body,
      item.replyTo ? { replyToId: item.replyTo.id } : {},
    );
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
    mutationFn: async ({ body, replyTo }: { body: string; replyTo?: ReplyPreviewDto | undefined }) => {
      const item: OutboxItem = {
        clientMessageId: newClientMessageId(),
        conversationId,
        body,
        replyTo,
        createdAt: new Date().toISOString(),
        state: 'sending',
      };
      useOutbox.getState().add(item);
      await deliver(client, item);
    },
  });
}

/**
 * Sends a file (with an optional caption). Needs a connection: files aren't queued offline.
 * Throws an Error with a user-facing message.
 */
export function useSendAttachment(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, caption, replyTo }: { file: File; caption: string; replyTo?: ReplyPreviewDto | undefined }) => {
      const prepared = await prepareFile(file);
      if (tooLarge(prepared)) throw new Error(t('chat.fileTooLarge'));
      const attachment = await chatApi.uploadAttachment(conversationId, prepared, file.name);
      const message = await chatApi.send(conversationId, newClientMessageId(), caption.trim() || undefined, {
        attachmentId: attachment.id,
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      });
      seedAttachment(attachment.id, prepared);
      upsertMessage(client, message);
      void client.invalidateQueries({ queryKey: ['conversations', 'inbox'] });
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
