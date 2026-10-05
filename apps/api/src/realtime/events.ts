import type { Message, Persona } from '@hellogram/domain';
import type { LocalEventPublisher } from '@hellogram/infrastructure';
import { toMessageDto } from '../modules/chat/chat.mapper.js';
import type { Namespace } from 'socket.io';
import { accountRoom, personaRoom } from './rooms.js';

interface PersonaEvent {
  accountId: string;
  personaId: string;
}

/**
 * Turns domain events into socket emits. Services never touch Socket.IO.
 * Later phases add chat, request and call events here.
 */
export function registerRealtimeEvents(
  rt: Namespace,
  events: LocalEventPublisher,
  avatarUrl: (key: string | null) => string | null = () => null,
): void {
  events.subscribe('persona.updated', (event) => {
    const { accountId, personaId } = event.payload as PersonaEvent;
    rt.in(accountRoom(accountId)).socketsJoin(personaRoom(personaId));
    rt.to(accountRoom(accountId)).emit('persona:updated', { personaId });
  });

  events.subscribe('request.received', (event) => {
    const { personaId, requestId, locked } = event.payload as { personaId: string; requestId: string; locked: boolean };
    // Locked numbers get content-free payloads (rule 27).
    rt.to(personaRoom(personaId)).emit('request:new', locked ? { personaId } : { personaId, requestId });
  });

  events.subscribe('request.updated', (event) => {
    const { personaId, requestId, status, conversationId } = event.payload as {
      personaId: string;
      requestId: string;
      status: string;
      conversationId?: string;
    };
    rt.to(personaRoom(personaId)).emit('request:updated', { requestId, status, conversationId });
  });

  events.subscribe('conversation.created', (event) => {
    const { conversationId, personaIds } = event.payload as { conversationId: string; personaIds: string[] };
    for (const personaId of personaIds) {
      rt.to(personaRoom(personaId)).emit('conversation:updated', { conversationId });
    }
  });

  events.subscribe('message.created', (event) => {
    const p = event.payload as {
      message: Message;
      conversationId: string;
      senderPersonaId: string;
      senderAccountId: string;
      recipientPersonaId: string;
      recipientLocked: boolean;
      senderLocked?: boolean;
    };
    // Sender's other devices (content-free if the sending number is PIN-locked).
    rt.to(accountRoom(p.senderAccountId)).emit(
      'message:new',
      p.senderLocked ? { locked: true, personaId: p.senderPersonaId } : { message: toMessageDto(p.message, p.senderPersonaId) },
    );
    if (p.message.suppressed) return; // silent block: the recipient never hears about it
    rt.to(personaRoom(p.recipientPersonaId)).emit(
      'message:new',
      p.recipientLocked
        ? { locked: true, personaId: p.recipientPersonaId } // rule 27: no name, no preview
        : { message: toMessageDto(p.message, p.recipientPersonaId) },
    );
  });

  events.subscribe('message.delivered', (event) => {
    const p = event.payload as { conversationId: string; senderPersonaId: string; messageIds: string[] };
    rt.to(personaRoom(p.senderPersonaId)).emit('message:delivered', { conversationId: p.conversationId, messageIds: p.messageIds });
  });

  events.subscribe('message.read', (event) => {
    const p = event.payload as {
      conversationId: string;
      senderPersonaId: string;
      upToMessageId: string;
      receipts: boolean;
      readerAccountId: string;
    };
    if (p.receipts) {
      rt.to(personaRoom(p.senderPersonaId)).emit('message:read', { conversationId: p.conversationId, upToMessageId: p.upToMessageId });
    }
    rt.to(accountRoom(p.readerAccountId)).emit('conversation:updated', { conversationId: p.conversationId });
  });

  events.subscribe('message.deleted', (event) => {
    const p = event.payload as { conversationId: string; messageId: string; scope: string; personaIds: string[] };
    for (const personaId of p.personaIds) {
      rt.to(personaRoom(personaId)).emit('message:deleted', { conversationId: p.conversationId, messageId: p.messageId, scope: p.scope });
    }
  });

  events.subscribe('conversation.updated', (event) => {
    const p = event.payload as { conversationId: string; personaIds: string[] };
    for (const personaId of p.personaIds) {
      rt.to(personaRoom(personaId)).emit('conversation:updated', { conversationId: p.conversationId });
    }
  });

  events.subscribe('conversation.private_updated', (event) => {
    const p = event.payload as { conversationId: string; accountId: string };
    rt.to(accountRoom(p.accountId)).emit('conversation:updated', { conversationId: p.conversationId });
  });

  events.subscribe('vault.updated', (event) => {
    const p = event.payload as { conversationId: string | null; accountId: string };
    rt.to(accountRoom(p.accountId)).emit('vault:updated', { conversationId: p.conversationId });
  });

  events.subscribe('call.incoming', (event) => {
    const p = event.payload as {
      callId: string;
      conversationId: string;
      calleePersonaId: string;
      calleeLocked: boolean;
      caller: Persona;
      callee: Persona;
    };
    rt.to(personaRoom(p.calleePersonaId)).emit('call:incoming', {
      callId: p.callId,
      conversationId: p.conversationId,
      // Rule 27: a locked number only learns "Incoming call".
      caller: p.calleeLocked
        ? null
        : { id: p.caller.id, code: p.caller.code, displayName: p.caller.displayName, avatarUrl: avatarUrl(p.caller.avatarKey) },
      to: { personaId: p.callee.id, code: p.callee.code, labelIcon: p.callee.labelIcon, labelName: p.callee.labelName },
    });
  });

  events.subscribe('call.accepted', (event) => {
    const p = event.payload as { callId: string; callerPersonaId: string; calleePersonaId: string };
    rt.to(personaRoom(p.callerPersonaId)).emit('call:accepted', { callId: p.callId });
    // The callee's other devices stop ringing.
    rt.to(personaRoom(p.calleePersonaId)).emit('call:ended', { callId: p.callId, reason: 'answered_elsewhere' });
  });

  events.subscribe('call.ended', (event) => {
    const p = event.payload as { callId: string; callerPersonaId: string; calleePersonaId: string; suppressed: boolean; reason: string };
    rt.to(personaRoom(p.callerPersonaId)).emit('call:ended', { callId: p.callId, reason: p.reason });
    if (!p.suppressed) rt.to(personaRoom(p.calleePersonaId)).emit('call:ended', { callId: p.callId, reason: p.reason });
  });

  events.subscribe('block.changed', (event) => {
    const { accountId } = event.payload as { accountId: string };
    rt.to(accountRoom(accountId)).emit('blocks:updated', {});
  });

  events.subscribe('persona.retired', (event) => {
    const { accountId, personaId } = event.payload as PersonaEvent;
    rt.to(accountRoom(accountId)).emit('persona:updated', { personaId, retired: true });
    rt.in(accountRoom(accountId)).socketsLeave(personaRoom(personaId));
  });
}
