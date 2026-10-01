import type { CallAcceptDto, CallLogEntryDto, CallStartDto } from '@hellogram/shared';
import { api } from '../../../core/http/client.js';

export const callsApi = {
  start: (conversationId: string) => api<CallStartDto>('/v1/calls', { method: 'POST', body: { conversationId } }),
  accept: (id: string) => api<CallAcceptDto>(`/v1/calls/${id}/accept`, { method: 'POST' }),
  decline: (id: string) => api<void>(`/v1/calls/${id}/decline`, { method: 'POST' }),
  end: (id: string) => api<void>(`/v1/calls/${id}/end`, { method: 'POST' }),
  log: (personaId?: string) =>
    api<{ items: CallLogEntryDto[]; nextCursor: string | null }>(`/v1/calls${personaId ? `?personaId=${personaId}` : ''}`),
};
