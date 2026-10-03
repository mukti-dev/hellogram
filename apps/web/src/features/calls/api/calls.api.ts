import type { CallAcceptDto, CallLogEntryDto, CallStartDto, IncomingCallEvent } from '@hellogram/shared';
import { api } from '../../../core/http/client.js';

export const callsApi = {
  start: (conversationId: string) => api<CallStartDto>('/v1/calls', { method: 'POST', body: { conversationId } }),
  accept: (id: string) => api<CallAcceptDto>(`/v1/calls/${id}/accept`, { method: 'POST' }),
  /** A call still ringing for me (opened from its notification). 404 once it has ended. */
  ringing: (id: string) => api<IncomingCallEvent>(`/v1/calls/${id}`),
  decline: (id: string) => api<void>(`/v1/calls/${id}/decline`, { method: 'POST' }),
  end: (id: string) => api<void>(`/v1/calls/${id}/end`, { method: 'POST' }),
  log: (personaId?: string) =>
    api<{ items: CallLogEntryDto[]; nextCursor: string | null }>(`/v1/calls${personaId ? `?personaId=${personaId}` : ''}`),
};
