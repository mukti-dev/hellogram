import type { ReportBody } from '@hellogram/shared';
import { api } from '../../../core/http/client.js';

export const safetyApi = {
  blockConversation: (id: string) => api<void>(`/v1/conversations/${id}/block`, { method: 'POST' }),
  report: (body: ReportBody) => api<{ id: string }>('/v1/reports', { method: 'POST', body }),
};
