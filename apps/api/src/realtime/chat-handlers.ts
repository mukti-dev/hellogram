import type { ChatService } from '@hellogram/application';
import type { Actor } from '@hellogram/domain';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { personaRoom } from './rooms.js';

const TYPING_THROTTLE_MS = 3_000;
const ack = z.object({ messageIds: z.array(z.uuid()).min(1).max(200) });
const read = z.object({ conversationId: z.uuid(), upToMessageId: z.uuid() });
const typing = z.object({ conversationId: z.uuid() });

/** Thin socket handlers: validate, call ChatService, never touch the database. */
export function chatSocketHandlers(chat: ChatService) {
  return (socket: Socket, actor: Actor, rt: Namespace) => {
    const lastTyping = new Map<string, number>();

    socket.on('message:ack', async (raw: unknown) => {
      const parsed = ack.safeParse(raw);
      if (parsed.success) await chat.ackDelivered(actor, parsed.data.messageIds).catch(() => undefined);
    });

    socket.on('message:read', async (raw: unknown) => {
      const parsed = read.safeParse(raw);
      if (parsed.success) {
        await chat.markRead(actor, parsed.data.conversationId, parsed.data.upToMessageId).catch(() => undefined);
      }
    });

    // Rule 18: at most one typing event per conversation every 3 seconds.
    socket.on('typing', async (raw: unknown) => {
      const parsed = typing.safeParse(raw);
      if (!parsed.success) return;
      const { conversationId } = parsed.data;
      const now = Date.now();
      if (now - (lastTyping.get(conversationId) ?? 0) < TYPING_THROTTLE_MS) return;
      lastTyping.set(conversationId, now);
      const target = await chat.typingTarget(actor, conversationId);
      if (target) rt.to(personaRoom(target.personaId)).emit('typing', { conversationId });
    });
  };
}
