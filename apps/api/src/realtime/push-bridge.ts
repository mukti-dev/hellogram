import type { PushIntent, PushTriggers } from '@hellogram/application';
import type { Message, Persona } from '@hellogram/domain';
import type { LocalEventPublisher, NotificationQueue } from '@hellogram/infrastructure';
import type { Namespace } from 'socket.io';
import { accountRoom } from './rooms.js';

/**
 * Domain events → push notifications. Pushes are skipped when the account has the
 * app open (a live socket anywhere, via the Redis adapter). Presence is only used
 * server-side and never exposed (rule 20).
 */
export function registerPushBridge(rt: Namespace | null, events: LocalEventPublisher, triggers: PushTriggers, queue: NotificationQueue) {
  const deliver = async (intent: PushIntent | null) => {
    if (!intent) return;
    if (intent.onlyIfOffline && rt) {
      const sockets = await rt.in(accountRoom(intent.accountId)).fetchSockets();
      if (sockets.length > 0) return;
    }
    await queue.push(intent.accountId, intent.payload);
  };
  const safely = (fn: () => Promise<void>) => void fn().catch(() => undefined);

  events.subscribe('message.created', (event) =>
    safely(async () => deliver(await triggers.forMessage(event.payload as { message: Message; conversationId: string; senderPersonaId: string; recipientPersonaId: string }))),
  );
  events.subscribe('request.received', (event) =>
    safely(async () => deliver(await triggers.forRequest(event.payload as { personaId: string }))),
  );
  events.subscribe('call.incoming', (event) =>
    safely(async () => deliver(triggers.forCall(event.payload as { callee: Persona; caller: Persona; calleeLocked: boolean }))),
  );
}
