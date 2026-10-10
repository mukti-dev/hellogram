import type { CallService } from '@hellogram/application';
import type { Actor } from '@hellogram/domain';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { personaRoom, sessionRoom } from './rooms.js';

/** How long a device may be gone (network switch, brief drop) before its call is hung up. */
const DROP_GRACE_MS = 30_000;

const signal = z.object({
  callId: z.uuid(),
  kind: z.enum(['offer', 'answer', 'ice']),
  data: z.record(z.string(), z.unknown()),
});

/**
 * Relays WebRTC offer/answer/ICE between the two parties of a call, and hangs up a call whose
 * device stays disconnected (the app was closed or crashed mid-call).
 */
export function callSocketHandlers(calls: CallService) {
  return (socket: Socket, actor: Actor, rt: Namespace) => {
    socket.on('disconnect', () => {
      setTimeout(() => {
        void (async () => {
          if ((await rt.in(sessionRoom(actor.sessionId)).fetchSockets()).length > 0) return;
          await calls.dropSession(actor);
        })().catch(() => undefined);
      }, DROP_GRACE_MS).unref();
    });
    socket.on('call:signal', async (raw: unknown) => {
      const parsed = signal.safeParse(raw);
      if (!parsed.success || JSON.stringify(parsed.data.data).length > 20_000) return;
      const target = await calls.signalTarget(actor, parsed.data.callId);
      if (target) rt.to(personaRoom(target.toPersonaId)).emit('call:signal', parsed.data);
    });
  };
}
