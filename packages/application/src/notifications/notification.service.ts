import type { PushPayload, PushSender, PushSubscriptionRepository } from '@hellogram/domain';

/** Web Push delivery (runs in the worker). Locked-number redaction happens before this. */
export class NotificationService {
  constructor(private readonly deps: { subscriptions: PushSubscriptionRepository; sender: PushSender | null }) {}

  subscribe(input: { accountId: string; sessionId: string; endpoint: string; p256dh: string; auth: string }) {
    return this.deps.subscriptions.upsert(input);
  }

  unsubscribe(accountId: string, endpoint: string) {
    return this.deps.subscriptions.remove(accountId, endpoint);
  }

  async sendToAccount(accountId: string, payload: PushPayload): Promise<number> {
    if (!this.deps.sender) return 0;
    let sent = 0;
    for (const sub of await this.deps.subscriptions.listForAccount(accountId)) {
      const result = await this.deps.sender.send(sub, payload).catch(() => 'ok' as const);
      if (result === 'gone') await this.deps.subscriptions.deleteById(sub.id);
      else sent++;
    }
    return sent;
  }
}
