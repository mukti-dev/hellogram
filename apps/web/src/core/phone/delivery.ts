import { useQuery } from '@tanstack/react-query';
import { api } from '../http/client.js';

export type OtpDelivery = 'sms' | 'call_or_sms';

export interface AuthConfig {
  phoneAuth: 'otp' | 'firebase';
  otpDelivery?: OtpDelivery;
  /** The Terms/Privacy version sign-up accepts. */
  consentVersion?: string;
}

/** Server-side auth settings (fetched once). */
export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<AuthConfig>('/v1/auth/config', { auth: false }),
    staleTime: Infinity,
    retry: 1,
  });
}

/** How the server delivers phone codes (2Factor may read the code out in a voice call). */
export function useOtpDelivery(): OtpDelivery {
  return useAuthConfig().data?.otpDelivery ?? 'sms';
}
