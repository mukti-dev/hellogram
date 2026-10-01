import { useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '../../features/auth/model/auth-store.js';
import { flushOutbox } from '../../features/chat/model/send.js';
import { registerRealtimeHandlers } from './handlers.js';
import { connectRealtime, disconnectRealtime } from './socket.js';

/** Connects while signed in and routes server events into the query cache. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const client = useQueryClient();

  useEffect(() => {
    if (status !== 'authenticated') return;
    const socket = connectRealtime(() => useAuthStore.getState().accessToken);
    const unregister = registerRealtimeHandlers(socket, client);
    // Offline queue: retry pending messages whenever we're back.
    const flush = () => void flushOutbox(client);
    socket.on('connect', flush);
    window.addEventListener('online', flush);
    flush();
    return () => {
      unregister();
      socket.off('connect', flush);
      window.removeEventListener('online', flush);
      disconnectRealtime();
    };
  }, [status, client]);

  return children;
}
