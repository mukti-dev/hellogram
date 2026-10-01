import { api } from '../../../core/http/client.js';
import type { PhoneProof } from '../../../core/phone/verification.js';
import { deviceName } from '../model/device-name.js';

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  isNewAccount: boolean;
}

export const authApi = {
  sendPhoneOtp: (phone: string, turnstileToken?: string | null) =>
    api<void>('/v1/auth/otp/send', { method: 'POST', body: { phone, ...(turnstileToken ? { turnstileToken } : {}) }, auth: false }),

  verifyPhoneOtp: (input: { phone: string; code: string; ageConfirmed?: boolean; consentVersion?: string }) =>
    api<LoginResponse>('/v1/auth/otp/verify', {
      method: 'POST',
      body: { ...input, deviceName: deviceName() },
      auth: false,
    }),

  /** Firebase Phone Auth: exchange Google's ID token for a Hellogram session. */
  verifyFirebase: (input: { idToken: string; ageConfirmed?: boolean; consentVersion?: string }) =>
    api<LoginResponse>('/v1/auth/firebase', { method: 'POST', body: { ...input, deviceName: deviceName() }, auth: false }),

  /** Signs in with whichever proof the phone verification produced. */
  verifyPhoneProof: (phone: string, proof: PhoneProof, consent: { ageConfirmed?: boolean; consentVersion?: string } = {}) =>
    'idToken' in proof
      ? authApi.verifyFirebase({ idToken: proof.idToken, ...consent })
      : authApi.verifyPhoneOtp({ phone, code: proof.code, ...consent }),

  sendEmailOtp: (email: string, turnstileToken?: string | null) =>
    api<void>('/v1/auth/email/otp/send', { method: 'POST', body: { email, ...(turnstileToken ? { turnstileToken } : {}) }, auth: false }),

  verifyEmailOtp: (input: { email: string; code: string }) =>
    api<LoginResponse>('/v1/auth/email/otp/verify', {
      method: 'POST',
      body: { ...input, deviceName: deviceName() },
      auth: false,
    }),

  logout: () => api<void>('/v1/auth/logout', { method: 'POST', auth: false }),
};

export interface Me {
  phone: string;
  email: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export interface DeviceSession {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export const meApi = {
  get: () => api<Me>('/v1/me'),
  sessions: () => api<{ items: DeviceSession[] }>('/v1/me/sessions'),
  revokeSession: (id: string) => api<void>(`/v1/me/sessions/${id}`, { method: 'DELETE' }),
  startEmail: (email: string) => api<void>('/v1/me/email', { method: 'POST', body: { email } }),
  confirmEmail: (email: string, code: string) => api<void>('/v1/me/email/verify', { method: 'POST', body: { email, code } }),
};
