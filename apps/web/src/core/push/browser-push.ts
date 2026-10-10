import { api } from '../http/client.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported() || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Signed in: ties this browser's notifications (if they were turned on) to the current session,
 * so they keep working after signing in again and stop once that session ends.
 */
export async function relinkBrowserPush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api('/v1/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } }).catch(() => undefined);
}

/** Signing out (needs the session, so before logout): the server stops sending to this browser. */
export async function forgetBrowserPush(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  await api('/v1/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => undefined);
}
