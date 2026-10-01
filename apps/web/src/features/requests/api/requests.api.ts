import type { BlockDto, IncomingRequestDto, PublicCardDto, SendRequestBody, SentRequestDto } from '@hellogram/shared';
import { api } from '../../../core/http/client.js';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const requestsApi = {
  incoming: (status: 'pending' | 'blocked') => api<Page<IncomingRequestDto>>(`/v1/requests?status=${status}`),
  count: () => api<{ count: number }>('/v1/requests/count'),
  sent: () => api<Page<SentRequestDto>>('/v1/requests/sent'),
  send: (body: SendRequestBody) => api<SentRequestDto>('/v1/requests', { method: 'POST', body }),
  accept: (id: string) => api<{ conversationId: string }>(`/v1/requests/${id}/accept`, { method: 'POST' }),
  decline: (id: string) => api<void>(`/v1/requests/${id}/decline`, { method: 'POST' }),
  block: (id: string) => api<void>(`/v1/requests/${id}/block`, { method: 'POST' }),
  publicCard: (code: string) => api<PublicCardDto>(`/v1/public/numbers/${encodeURIComponent(code)}`, { auth: false }),
  blocks: () => api<{ items: BlockDto[] }>('/v1/blocks'),
  unblock: (id: string) => api<void>(`/v1/blocks/${id}`, { method: 'DELETE' }),
};
