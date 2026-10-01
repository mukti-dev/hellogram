import { api } from '../../../core/http/client.js';
import type { PhoneProof } from '../../../core/phone/verification.js';
import { deviceName } from '../model/device-name.js';

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
}

export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export interface SignupInput {
  name: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender;
  password: string;
  termsAccepted: true;
  consentVersion: string;
}

export type PasswordLoginResponse = ({ status: 'ok' } & LoginResponse) | { status: 'verify_device'; ticket: string };

const proofBody = (proof: PhoneProof) => ('idToken' in proof ? { idToken: proof.idToken } : { code: proof.code });
const human = (turnstileToken?: string | null) => (turnstileToken ? { turnstileToken } : {});

/** Sign-up → mobile code → account; login = mobile + password (a new device verifies the mobile once). */
export const authApi = {
  config: () => api<{ phoneAuth: 'otp' | 'firebase'; otpDelivery: 'sms' | 'call_or_sms' }>('/v1/auth/config', { auth: false }),

  signup: (input: SignupInput, turnstileToken?: string | null) =>
    api<{ signupId: string }>('/v1/auth/signup', { method: 'POST', body: { ...input, ...human(turnstileToken) }, auth: false }),
  signupResend: (signupId: string) => api<void>('/v1/auth/signup/resend', { method: 'POST', body: { signupId }, auth: false }),
  signupVerify: (signupId: string, proof: PhoneProof) =>
    api<LoginResponse>('/v1/auth/signup/verify', {
      method: 'POST',
      body: { signupId, ...proofBody(proof), deviceName: deviceName() },
      auth: false,
    }),

  login: (phone: string, password: string, turnstileToken?: string | null) =>
    api<PasswordLoginResponse>('/v1/auth/login', {
      method: 'POST',
      body: { phone, password, deviceName: deviceName(), ...human(turnstileToken) },
      auth: false,
    }),
  loginResend: (ticket: string) => api<void>('/v1/auth/login/resend', { method: 'POST', body: { ticket }, auth: false }),
  loginVerify: (ticket: string, proof: PhoneProof) =>
    api<LoginResponse>('/v1/auth/login/verify', {
      method: 'POST',
      body: { ticket, ...proofBody(proof), deviceName: deviceName() },
      auth: false,
    }),

  forgotPassword: (phone: string, turnstileToken?: string | null) =>
    api<void>('/v1/auth/password/forgot', { method: 'POST', body: { phone, ...human(turnstileToken) }, auth: false }),
  resetPassword: (phone: string, proof: PhoneProof, password: string) =>
    api<LoginResponse>('/v1/auth/password/reset', {
      method: 'POST',
      body: { phone, password, ...proofBody(proof), deviceName: deviceName() },
      auth: false,
    }),

  logout: () => api<void>('/v1/auth/logout', { method: 'POST', auth: false }),
};

export interface Me {
  phone: string;
  name: string | null;
  /** YYYY-MM-DD */
  dateOfBirth: string | null;
  gender: Gender | null;
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
  updateName: (name: string) => api<Me>('/v1/me', { method: 'PATCH', body: { name } }),
  sessions: () => api<{ items: DeviceSession[] }>('/v1/me/sessions'),
  revokeSession: (id: string) => api<void>(`/v1/me/sessions/${id}`, { method: 'DELETE' }),
  startEmail: (email: string) => api<void>('/v1/me/email', { method: 'POST', body: { email } }),
  confirmEmail: (email: string, code: string) => api<void>('/v1/me/email/verify', { method: 'POST', body: { email, code } }),
};
