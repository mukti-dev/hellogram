import type {
  Clock,
  NativePushSender,
  NativePushTokenRecord,
  NativePushTokenRepository,
  PushPayload,
  PushSender,
  PushSubscriptionRepository,
} from '@hellogram/domain';

/**
 * Which phone tokens a payload goes to. On iOS, calls ring CallKit through PushKit ("voip");
 * everything else (messages, requests, the end of a call) is a normal "alert". Android has one token.
 */
const isCallRing = (payload: PushPayload) => payload.kind === 'call';
export const wantsToken = (token: Pick<NativePushTokenRecord, 'platform' | 'kind'>, payload: PushPayload) =>
  token.platform === 'android' || token.kind === (isCallRing(payload) ? 'voip' : 'alert');

/**
 * Push delivery (runs in the worker): Web Push to browsers, and APNs / FCM to the mobile app
 * once those senders are configured. Locked-number redaction happens before this.
 */
export class NotificationService {
  constructor(
    private readonly deps: {
      subscriptions: PushSubscriptionRepository;
      sender: PushSender | null;
      nativeTokens?: NativePushTokenRepository;
      /** null until APNs / FCM credentials are set: phone tokens are kept, nothing is sent. */
      nativeSender?: NativePushSender | null;
      clock?: Clock;
    },
  ) {}

  subscribe(input: { accountId: string; sessionId: string; endpoint: string; p256dh: string; auth: string }) {
    return this.deps.subscriptions.upsert(input);
  }

  unsubscribe(accountId: string, endpoint: string) {
    return this.deps.subscriptions.remove(accountId, endpoint);
  }

  registerNative(input: { accountId: string; sessionId: string; platform: 'ios' | 'android'; kind: 'voip' | 'alert'; token: string }) {
    if (!this.deps.nativeTokens) throw new Error('Native push tokens are not configured');
    return this.deps.nativeTokens.upsert(input);
  }

  async unregisterNative(accountId: string, token: string) {
    await this.deps.nativeTokens?.remove(accountId, token);
  }

  async sendToAccount(accountId: string, payload: PushPayload): Promise<number> {
    return (await this.sendToBrowsers(accountId, payload)) + (await this.sendToPhones(accountId, payload));
  }

  private async sendToBrowsers(accountId: string, payload: PushPayload): Promise<number> {
    if (!this.deps.sender) return 0;
    let sent = 0;
    for (const sub of await this.deps.subscriptions.listForAccount(accountId)) {
      const result = await this.deps.sender.send(sub, payload).catch(() => 'ok' as const);
      if (result === 'gone') await this.deps.subscriptions.deleteById(sub.id);
      else sent++;
    }
    return sent;
  }

  private async sendToPhones(accountId: string, payload: PushPayload): Promise<number> {
    const { nativeTokens, nativeSender } = this.deps;
    if (!nativeTokens || !nativeSender) return 0;
    let sent = 0;
    const now = this.deps.clock?.now() ?? new Date();
    for (const token of await nativeTokens.listForAccount(accountId, now)) {
      if (!wantsToken(token, payload)) continue;
      const result = await nativeSender.send(token, payload).catch(() => 'ok' as const);
      if (result === 'gone') await nativeTokens.deleteById(token.id);
      else sent++;
    }
    return sent;
  }
}
