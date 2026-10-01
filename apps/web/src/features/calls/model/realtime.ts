import type { CallSignal, ConversationDto, IncomingCallEvent } from '@hellogram/shared';
import { onRealtime } from '../../../core/realtime/handlers.js';
import { chatKeys } from '../../chat/model/keys.js';
import './call-sounds.js';
import { useCallStore } from './call-store.js';

onRealtime('call:incoming', (client) => (event: IncomingCallEvent) => {
  // My private nickname for this chat, if I set one.
  const conversation = client.getQueryData<ConversationDto>(chatKeys.one(event.conversationId));
  useCallStore.getState().receiveIncoming(event, {
    name: event.caller ? (conversation?.nickname ?? event.caller.displayName) : 'Incoming call',
    avatarUrl: event.caller?.avatarUrl ?? null,
    labelKind: event.to.labelKind,
    labelText: event.to.labelText,
    code: event.to.code,
  });
  void client.invalidateQueries({ queryKey: ['calls'] });
});

onRealtime('call:accepted', () => (p: { callId: string }) => useCallStore.getState().onAccepted(p.callId));

onRealtime('call:ended', (client) => (p: { callId: string; reason: string }) => {
  useCallStore.getState().onRemoteEnded(p.callId, p.reason);
  void client.invalidateQueries({ queryKey: ['calls'] });
});

onRealtime('call:signal', () => (signal: CallSignal) => useCallStore.getState().onSignal(signal));
