import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { callsApi } from '../api/calls.api.js';
import { useCallStore } from './call-store.js';
import { partyFor } from './party.js';

/**
 * The incoming-call notification, so a call is noticed while Hellogram is in a background tab,
 * minimised or behind other apps (web pages can't draw over other apps; a system notification can).
 * The server also pushes it (for a closed app); both use the same tag, so only one ever shows.
 */
const tagFor = (callId: string) => `call-${callId}`;

const backgrounded = () => document.visibilityState === 'hidden' || !document.hasFocus();

async function toWorker(message: Record<string, unknown>) {
  if (!('serviceWorker' in navigator) || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  registration?.active?.postMessage(message);
}

/** Same wording as the server's push. Never the private label; nothing at all for a PIN-locked number. */
const show = (callId: string, name: string, toCode: string | null, locked: boolean) =>
  void toWorker({
    type: 'hg-call-show',
    call: {
      kind: 'call',
      callId,
      tag: tagFor(callId),
      title: locked ? 'Incoming call' : `Incoming call from ${name}`,
      body: locked || !toCode ? 'Tap to answer in Hellogram' : `to ${toCode}`,
      url: `/inbox?call=${callId}`,
    },
  });

const clear = (callId: string) => void toWorker({ type: 'hg-call-clear', call: { callId, tag: tagFor(callId) } });

useCallStore.subscribe((state, prev) => {
  if (state.phase === 'incoming' && prev.phase !== 'incoming' && state.callId && state.party && backgrounded()) {
    show(state.callId, state.party.name, state.party.code, state.locked);
  }
  if (prev.phase === 'incoming' && state.phase !== 'incoming' && prev.callId) clear(prev.callId);
});

// Back on screen: the in-app call screen takes over from the notification.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const { phase, callId } = useCallStore.getState();
    if (document.visibilityState === 'visible' && phase === 'incoming' && callId) clear(callId);
  });
}

type Action = 'show' | 'accept' | 'decline';

/** Shows (and with "accept", answers) a call that is ringing for me, if it still is. */
async function openRinging(client: QueryClient, callId: string, action: Action) {
  const store = useCallStore.getState();
  if (action === 'decline') {
    if (store.callId === callId && store.phase === 'incoming') await store.decline();
    return;
  }
  if (store.callId !== callId) {
    if (store.phase !== 'idle') return; // busy with another call
    const event = await callsApi.ringing(callId).catch(() => null);
    if (!event) return; // it stopped ringing meanwhile
    store.receiveIncoming(event, partyFor(client, event));
  }
  if (action === 'accept' && useCallStore.getState().phase === 'incoming') await useCallStore.getState().accept();
}

/**
 * Accept / Decline / tap from the notification: in this window (sent by the service worker), or
 * when the notification opened Hellogram (/inbox?call=…&answer=1). Mounted once, in the app shell.
 */
export function useCallNotificationActions() {
  const client = useQueryClient();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string; callId?: string; action?: Action } | undefined;
      if (msg?.type === 'hg-call' && msg.callId && msg.action) void openRinging(client, msg.callId, msg.action);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [client]);

  // Opened from the notification.
  const callId = params.get('call');
  const answer = params.get('answer') === '1';
  useEffect(() => {
    if (!callId) return;
    navigate('/inbox', { replace: true });
    void openRinging(client, callId, answer ? 'accept' : 'show');
  }, [callId, answer, client, navigate]);
}
