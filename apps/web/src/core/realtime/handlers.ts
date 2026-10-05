import type { QueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';

type Handler = (payload: never) => void;
const extraHandlers: { event: string; make: (client: QueryClient) => Handler }[] = [];

/** Feature modules (chat, calls) register their socket handlers here. */
export function onRealtime(event: string, make: (client: QueryClient) => Handler): void {
  extraHandlers.push({ event, make });
}

export function registerRealtimeHandlers(socket: Socket, client: QueryClient): () => void {
  const base: Record<string, () => void> = {
    'persona:updated': () => void client.invalidateQueries({ queryKey: ['personas'] }),
    'request:new': () => void client.invalidateQueries({ queryKey: ['requests'] }),
    'request:updated': () => {
      void client.invalidateQueries({ queryKey: ['requests'] });
      void client.invalidateQueries({ queryKey: ['conversations'] });
    },
    'conversation:updated': () => void client.invalidateQueries({ queryKey: ['conversations'] }),
    // A chat was archived, locked or hidden (from the mobile app): it leaves this inbox.
    'vault:updated': () => void client.invalidateQueries({ queryKey: ['conversations'] }),
    'blocks:updated': () => void client.invalidateQueries({ queryKey: ['blocks'] }),
  };
  for (const [event, handler] of Object.entries(base)) socket.on(event, handler);
  const extras = extraHandlers.map(({ event, make }) => {
    const handler = make(client) as (...args: unknown[]) => void;
    socket.on(event, handler);
    return { event, handler };
  });
  const onReconnect = () => void client.invalidateQueries();
  socket.io.on('reconnect', onReconnect);

  return () => {
    for (const [event, handler] of Object.entries(base)) socket.off(event, handler);
    for (const { event, handler } of extras) socket.off(event, handler);
    socket.io.off('reconnect', onReconnect);
  };
}
