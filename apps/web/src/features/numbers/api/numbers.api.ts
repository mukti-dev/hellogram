import type {
  CheckoutDto,
  CreatePersonaBody,
  OwnPersonaDto,
  PersonaListDto,
  ShareDto,
  UpdatePersonaBody,
} from '@hellogram/shared';
import { ApiError } from '../../../core/http/api-error.js';
import { api } from '../../../core/http/client.js';

export type CreateResult = { kind: 'created'; persona: OwnPersonaDto } | { kind: 'checkout'; checkout: CheckoutDto };

export const numbersApi = {
  list: () => api<PersonaListDto>('/v1/personas'),
  get: (id: string) => api<OwnPersonaDto>(`/v1/personas/${id}`),

  /** 201 → created; 402 with `{ checkout }` → payment needed for a paid slot. */
  async create(body: CreatePersonaBody): Promise<CreateResult> {
    try {
      return { kind: 'created', persona: await api<OwnPersonaDto>('/v1/personas', { method: 'POST', body }) };
    } catch (error) {
      const raw = error instanceof ApiError ? (error.raw as { checkout?: CheckoutDto } | undefined) : undefined;
      if (error instanceof ApiError && error.status === 402 && raw?.checkout) {
        return { kind: 'checkout', checkout: raw.checkout };
      }
      throw error;
    }
  },

  update: (id: string, body: UpdatePersonaBody) => api<OwnPersonaDto>(`/v1/personas/${id}`, { method: 'PATCH', body }),
  pause: (id: string) => api<OwnPersonaDto>(`/v1/personas/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => api<OwnPersonaDto>(`/v1/personas/${id}/resume`, { method: 'POST' }),
  retire: (id: string) => api<void>(`/v1/personas/${id}`, { method: 'DELETE', body: { confirm: 'DELETE' } }),
  share: (id: string) => api<ShareDto>(`/v1/personas/${id}/share`),
  uploadAvatar: (id: string, file: File) =>
    api<OwnPersonaDto>(`/v1/personas/${id}/avatar`, { method: 'PUT', rawBody: file, contentType: file.type }),
  removeAvatar: (id: string) => api<OwnPersonaDto>(`/v1/personas/${id}/avatar`, { method: 'DELETE' }),
};
