import { api } from '../../../core/http/client.js';
import type { PhoneProof } from '../../../core/phone/verification.js';

interface Unlock {
  unlockToken: string;
  expiresIn: number;
}

export const pinApi = {
  set: (personaId: string, pin: string, currentPin?: string) =>
    api<Unlock>(`/v1/personas/${personaId}/pin`, { method: 'PUT', body: { pin, ...(currentPin ? { currentPin } : {}) } }),
  remove: (personaId: string, pin: string) => api<void>(`/v1/personas/${personaId}/pin`, { method: 'DELETE', body: { pin } }),
  unlock: (personaId: string, pin: string) => api<Unlock>(`/v1/personas/${personaId}/unlock`, { method: 'POST', body: { pin } }),
  sendResetOtp: (personaId: string) => api<void>(`/v1/personas/${personaId}/pin/reset/otp`, { method: 'POST' }),
  reset: (personaId: string, proof: PhoneProof, newPin: string) =>
    api<Unlock>(`/v1/personas/${personaId}/pin/reset`, { method: 'POST', body: { ...proof, newPin } }),
};
