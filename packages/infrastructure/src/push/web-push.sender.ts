import type { PushPayload, PushSender, PushSubscriptionRecord } from '@hellogram/domain';
import webpush from 'web-push';

/** Web Push via VAPID (no vendor). Browser push services are free. */
export class WebPushSender implements PushSender {
  constructor(vapid: { subject: string; publicKey: string; privateKey: string }) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async send(sub: PushSubscriptionRecord, payload: PushPayload): Promise<'ok' | 'gone'> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: 'high' },
      );
      return 'ok';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      throw error;
    }
  }
}
