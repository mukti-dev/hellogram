import type {
  AttachmentDto,
  ConversationDto,
  InboxDto,
  MessageDto,
  MessagePageDto,
  UpdateConversationBody,
} from '@hellogram/shared';
import { api, apiBlob } from '../../../core/http/client.js';

export interface InboxFilter {
  /** One of the user's own labels. */
  label?: string;
  unread?: boolean;
  q?: string;
}

const qs = (params: Record<string, string | boolean | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== false) search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const chatApi = {
  inbox: (filter: InboxFilter, cursor?: string) => api<InboxDto>(`/v1/conversations${qs({ ...filter, cursor })}`),
  unreadCount: () => api<{ count: number }>('/v1/conversations/unread-count'),
  get: (id: string) => api<ConversationDto>(`/v1/conversations/${id}`),
  messages: (id: string, cursor?: string) => api<MessagePageDto>(`/v1/conversations/${id}/messages${qs({ cursor })}`),
  send: (id: string, clientMessageId: string, body: string | undefined, extra: { attachmentId?: string; replyToId?: string } = {}) =>
    api<MessageDto>(`/v1/conversations/${id}/messages`, {
      method: 'POST',
      body: {
        clientMessageId,
        ...(body ? { body } : {}),
        ...(extra.attachmentId ? { attachmentId: extra.attachmentId } : {}),
        ...(extra.replyToId ? { replyToId: extra.replyToId } : {}),
      },
    }),
  /** Step 1 of sending a file; the returned id goes into `send`. */
  uploadAttachment: (id: string, file: Blob, fileName: string) =>
    api<AttachmentDto>(`/v1/conversations/${id}/attachments`, {
      method: 'POST',
      rawBody: file,
      contentType: 'application/octet-stream',
      headers: { 'X-File-Name': encodeURIComponent(fileName) },
    }),
  downloadAttachment: (attachmentId: string) => apiBlob(`/v1/attachments/${attachmentId}`),
  read: (id: string, upToMessageId: string) =>
    api<void>(`/v1/conversations/${id}/read`, { method: 'POST', body: { upToMessageId } }),
  ack: (messageIds: string[]) => api<void>('/v1/messages/ack', { method: 'POST', body: { messageIds } }),
  update: (id: string, body: UpdateConversationBody) =>
    api<ConversationDto>(`/v1/conversations/${id}`, { method: 'PATCH', body }),
  clear: (id: string) => api<void>(`/v1/conversations/${id}/clear`, { method: 'POST' }),
  deleteMessage: (id: string, scope: 'me' | 'everyone') => api<void>(`/v1/messages/${id}?scope=${scope}`, { method: 'DELETE' }),
};
