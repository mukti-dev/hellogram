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
}

// Web Push. Payloads for PIN-locked numbers arrive already redacted by the server.
self.addEventListener('push', (event) => {
  const data = (event.data?.json() ?? { title: 'Hellogram', body: '', url: '/' }) as PushPayload;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.navigate(url).catch(() => undefined);
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
