import { io, type Socket } from 'socket.io-client';
import { refreshAccessToken } from '../http/client.js';

/**
 * One Socket.IO connection per tab on namespace /rt (framework-free).
 * Re-authenticates with a fresh access token on every (re)connect.
 */
let socket: Socket | null = null;

export function connectRealtime(getToken: () => string | null): Socket {
  if (socket) return socket;
  socket = io('/rt', {
    path: '/socket.io',
    transports: ['websocket'],
    auth: (cb) => cb({ token: getToken() }),
    reconnectionDelayMax: 10_000,
  });
  socket.on('connect_error', async (error: Error & { data?: { code?: string } }) => {
    if (error.data?.code === 'UNAUTHENTICATED') {
      const token = await refreshAccessToken();
      if (token) socket?.connect();
    }
  });
  return socket;
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}
