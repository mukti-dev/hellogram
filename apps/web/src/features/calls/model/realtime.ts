import type { CallSignal, IncomingCallEvent } from '@hellogram/shared';
import { onRealtime } from '../../../core/realtime/handlers.js';
import './call-notifications.js';
import './call-sounds.js';
import { useCallStore } from './call-store.js';
import { partyFor } from './party.js';

onRealtime('call:incoming', (client) => (event: IncomingCallEvent) => {
  useCallStore.getState().receiveIncoming(event, partyFor(client, event));
  void client.invalidateQueries({ queryKey: ['calls'] });
});

onRealtime('call:accepted', () => (p: { callId: string }) => useCallStore.getState().onAccepted(p.callId));

onRealtime('call:ended', (client) => (p: { callId: string; reason: string }) => {
  useCallStore.getState().onRemoteEnded(p.callId, p.reason);
  void client.invalidateQueries({ queryKey: ['calls'] });
});

onRealtime('call:signal', () => (signal: CallSignal) => useCallStore.getState().onSignal(signal));
