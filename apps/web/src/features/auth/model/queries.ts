import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { authApi, meApi } from '../api/auth.api.js';
import { useAuthStore } from './auth-store.js';

export const meKeys = { me: ['me'] as const, sessions: ['me', 'sessions'] as const };

export const useMe = () => useQuery({ queryKey: meKeys.me, queryFn: meApi.get });

export const useSessions = () => useQuery({ queryKey: meKeys.sessions, queryFn: meApi.sessions });

export function useRevokeSession() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: meApi.revokeSession,
    onSuccess: () => client.invalidateQueries({ queryKey: meKeys.sessions }),
  });
}

export function useLogout() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const signOut = useAuthStore((s) => s.signOut);
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      signOut();
      client.clear();
      navigate('/login', { replace: true });
    },
  });
}

/** "+919876543210" → "+91 98765 43210" */
export const formatPhone = (e164: string) => `${e164.slice(0, 3)} ${e164.slice(3, 8)} ${e164.slice(8)}`;
