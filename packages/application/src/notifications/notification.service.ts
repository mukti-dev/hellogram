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
 * Which phone tokens a payload goes to. Everything goes to the app's "alert" token (Firebase).
 * A ringing call goes to an iPhone's "voip" token instead when that device has one (CallKit);
 * VoIP tokens never get anything else (iOS stops waking apps that get VoIP pushes without a call).
 */
const isCallRing = (payload: PushPayload) => payload.kind === 'call';
export function wantsToken(
  token: Pick<NativePushTokenRecord, 'platform' | 'kind' | 'sessionId'>,
  payload: PushPayload,
  voipSessions: ReadonlySet<string> = new Set(),
): boolean {
  if (token.kind === 'voip') return isCallRing(payload);
  return !(isCallRing(payload) && voipSessions.has(token.sessionId));
}

/**
 * Push delivery (runs in the worker): Web Push to browsers, and Firebase (FCM) to the mobile app
 * once FCM_SERVICE_ACCOUNT is set. Locked-number redaction happens before this.
 */
export class NotificationService {
  constructor(
    private readonly deps: {
      subscriptions: PushSubscriptionRepository;
      sender: PushSender | null;
      nativeTokens?: NativePushTokenRepository;
      /** null until FCM_SERVICE_ACCOUNT is set: phone tokens are kept, nothing is sent. */
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
    const tokens = await nativeTokens.listForAccount(accountId, now);
    const voipSessions = new Set(tokens.filter((t) => t.kind === 'voip').map((t) => t.sessionId));
    for (const token of tokens) {
      if (!wantsToken(token, payload, voipSessions)) continue;
      const result = await nativeSender.send(token, payload).catch(() => 'ok' as const);
      if (result === 'gone') await nativeTokens.deleteById(token.id);
      else sent++;
    }
    return sent;
  }
}
