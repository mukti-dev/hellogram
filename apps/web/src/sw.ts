/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// Offline app shell (§10).
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/v1\//, /^\/health/, /^\/media\//, /^\/socket\.io/],
  }),
);
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  kind?: 'call' | 'call_ended' | 'call_answered';
  callId?: string;
  declineToken?: string;
  missed?: boolean;
}

interface CallData {
  kind: 'call';
  url: string;
  callId: string;
  declineToken?: string;
}

/** Fields the DOM typings don't list yet (supported by Chrome/Edge/Firefox; ignored elsewhere). */
type RichOptions = NotificationOptions & {
  actions?: { action: string; title: string }[];
  vibrate?: number[];
  renotify?: boolean;
  requireInteraction?: boolean;
};

const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

/**
 * Notifications only while a Hellogram tab is open (signed in) but not the one being looked at:
 * nothing once every tab is closed, nothing while Hellogram is in front.
 */
const shouldNotify = async () => {
  const open = (await windows()).filter((w) => new URL(w.url).origin === self.location.origin);
  return open.length > 0 && !open.some((w) => w.focused && w.visibilityState === 'visible');
};

/** Every push must show something: when nothing should show, flash a silent one and close it at once. */
async function showNothing(tag = 'hg-quiet') {
  await self.registration.showNotification('Hellogram', { tag, silent: true });
  for (const n of await self.registration.getNotifications({ tag })) n.close();
}

/**
 * Ringing call: stays up (over other apps) until Accept/Decline, vibrates, and is replaced by
 * "Missed call…" or cleared when the call ends. Also used by the page when it's in the background.
 */
async function showCall(data: PushPayload) {
  const tag = data.tag ?? `call-${data.callId}`;
  // Already showing (the page posted it first): update it quietly with the Decline key.
  const showing = (await self.registration.getNotifications({ tag })).length > 0;
  const options: RichOptions = {
    body: data.body,
    tag,
    icon: '/icon.svg',
    badge: '/icon.svg',
    requireInteraction: true,
    renotify: !showing,
    silent: false,
    vibrate: [600, 300, 600, 300, 600, 300, 600],
    actions: [
      { action: 'decline', title: 'Decline' },
      { action: 'accept', title: 'Accept' },
    ],
    data: { kind: 'call', url: data.url, callId: data.callId, declineToken: data.declineToken } satisfies Partial<CallData>,
  };
  await self.registration.showNotification(data.title, options);
}

async function endCall(data: PushPayload) {
  const tag = data.tag ?? `call-${data.callId}`;
  for (const n of await self.registration.getNotifications({ tag })) n.close();
  if (!(await shouldNotify())) return showNothing(tag);
  if (data.missed) {
    await self.registration.showNotification(data.title, { body: data.body, tag, icon: '/icon.svg', badge: '/icon.svg', data: { url: data.url } });
    return;
  }
  // Every push must show something; this one only clears the ringing notification.
  await self.registration.showNotification(data.title, { tag, silent: true, data: { url: data.url } });
  for (const n of await self.registration.getNotifications({ tag })) n.close();
}

// Web Push. Payloads for PIN-locked numbers arrive already redacted by the server.
self.addEventListener('push', (event) => {
  const data = (event.data?.json() ?? { title: 'Hellogram', body: '', url: '/' }) as PushPayload;
  event.waitUntil(
    (async () => {
      if (data.kind === 'call_ended' || data.kind === 'call_answered') return endCall(data);
      if (!(await shouldNotify())) return showNothing();
      if (data.kind === 'call') return showCall(data);
      await self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        icon: '/icon.svg',
        badge: '/icon.svg',
        data: { url: data.url },
      });
    })(),
  );
});

// The page asks for the ringing notification while it's in the background (faster than a push).
self.addEventListener('message', (event) => {
  const msg = event.data as { type?: string; call?: PushPayload } | undefined;
  if (msg?.type === 'hg-call-show' && msg.call) event.waitUntil(showCall(msg.call));
  if (msg?.type === 'hg-call-clear' && msg.call) {
    const tag = msg.call.tag ?? `call-${msg.call.callId}`;
    event.waitUntil(self.registration.getNotifications({ tag }).then((all) => all.forEach((n) => n.close())));
  }
});

/** Tells an open Hellogram window what to do with the call, or opens one. */
async function openCall(callId: string, answer: boolean) {
  const open = (await windows()).find((w) => new URL(w.url).origin === self.location.origin);
  if (open) {
    await open.focus().catch(() => undefined);
    open.postMessage({ type: 'hg-call', callId, action: answer ? 'accept' : 'show' });
    return;
  }
  await self.clients.openWindow(`/inbox?call=${encodeURIComponent(callId)}${answer ? '&answer=1' : ''}`);
}

async function declineCall(data: CallData) {
  // An open window declines with its session (and stops its own ringing).
  for (const w of await windows()) w.postMessage({ type: 'hg-call', callId: data.callId, action: 'decline' });
  if (!data.declineToken) return;
  await fetch(`/v1/calls/${encodeURIComponent(data.callId)}/decline-from-notification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: data.declineToken }),
  }).catch(() => undefined);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as (Partial<CallData> & { url?: string }) | undefined;
  if (data?.kind === 'call' && data.callId) {
    const call = data as CallData;
    event.waitUntil(event.action === 'decline' ? declineCall(call) : openCall(call.callId, event.action === 'accept'));
    return;
  }
  const url = data?.url ?? '/';
  event.waitUntil(
    (async () => {
      const existing = (await windows()).find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.navigate(url).catch(() => undefined);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
