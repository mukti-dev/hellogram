import type { NativePushSender, NativePushTokenRecord, PushPayload } from '@hellogram/domain';
import { SignJWT, importPKCS8 } from 'jose';

/** The parts of a Firebase service-account key file this sender needs. */
export interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/** FCM_SERVICE_ACCOUNT: the key file's JSON, raw or base64-encoded (easier to keep on one env line). */
export function parseServiceAccount(value: string): FirebaseServiceAccount {
  const text = value.trim().startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
  const json = JSON.parse(text) as Partial<FirebaseServiceAccount>;
  if (!json.project_id || !json.client_email || !json.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT must be a Firebase service-account key (project_id, client_email, private_key)');
  }
  return { project_id: json.project_id, client_email: json.client_email, private_key: json.private_key };
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** Notification channels the app creates on Android (calls ring louder than messages). */
const ANDROID_CHANNEL = { call: 'calls', other: 'messages' } as const;

/**
 * Firebase Cloud Messaging (HTTP v1) for the mobile app, on Android and iPhone alike.
 * Firebase hands iPhone messages to Apple using the APNs key uploaded in the Firebase console.
 */
export class FcmSender implements NativePushSender {
  private access: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: FirebaseServiceAccount,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async send(token: NativePushTokenRecord, payload: PushPayload): Promise<'ok' | 'gone'> {
    const message = buildMessage(token.token, payload);
    if (!message) return 'ok';
    const response = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return 'ok';
    const body = (await response.json().catch(() => ({}))) as { error?: { status?: string; details?: { errorCode?: string }[] } };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status;
    // The app was uninstalled or the token was replaced: forget it.
    if (response.status === 404 || code === 'UNREGISTERED') return 'gone';
    if (code === 'INVALID_ARGUMENT' && response.status === 400 && /token/i.test(JSON.stringify(body))) return 'gone';
    throw new Error(`FCM responded ${response.status} ${code ?? ''}`.trim());
  }

  /** OAuth access token from the service account (cached until shortly before it expires). */
  private async accessToken(): Promise<string> {
    if (this.access && this.access.expiresAt > this.now() + 60_000) return this.access.token;
    const iat = Math.floor(this.now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(await importPKCS8(this.account.private_key, 'RS256'));
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Google OAuth responded ${response.status}`);
    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.access = { token: json.access_token, expiresAt: this.now() + json.expires_in * 1000 };
    return json.access_token;
  }
}

/** FCM data values must all be strings. */
const data = (payload: PushPayload): Record<string, string> =>
  Object.fromEntries(
    Object.entries({
      url: payload.url,
      kind: payload.kind,
      callId: payload.callId,
      declineToken: payload.declineToken,
      missed: payload.missed === undefined ? undefined : String(payload.missed),
      tag: payload.tag,
    }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );

/**
 * One FCM message for one phone:
 *  - a ringing call: shown at once with high priority (Android "calls" channel, iOS time-sensitive);
 *  - a call that was answered elsewhere or ended normally: data only, so an open app can tidy up;
 *  - "Missed call", messages, requests, billing: a normal notification. The same `tag` replaces
 *    the one before it (one notification per chat, the ringing call becomes "Missed call").
 */
export function buildMessage(token: string, payload: PushPayload): Record<string, unknown> | null {
  const ttl = payload.ttlSeconds ?? 60 * 60;
  const quiet = (payload.kind === 'call_ended' && !payload.missed) || payload.kind === 'call_answered';
  if (quiet) {
    return {
      token,
      data: data(payload),
      android: { priority: 'NORMAL', ttl: `${ttl}s` },
      apns: { headers: { 'apns-push-type': 'background', 'apns-priority': '5' }, payload: { aps: { 'content-available': 1 } } },
    };
  }
  const ringing = payload.kind === 'call';
  const tag = payload.tag?.slice(0, 64);
  return {
    token,
    notification: { title: payload.title, ...(payload.body ? { body: payload.body } : {}) },
    data: data(payload),
    android: {
      priority: 'HIGH',
      ttl: `${ttl}s`,
      ...(tag ? { collapse_key: tag } : {}),
      notification: {
        channel_id: ringing ? ANDROID_CHANNEL.call : ANDROID_CHANNEL.other,
        ...(tag ? { tag } : {}),
        ...(ringing ? { notification_priority: 'PRIORITY_MAX', visibility: 'PUBLIC' } : {}),
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + ttl),
        ...(tag ? { 'apns-collapse-id': tag } : {}),
      },
      payload: {
        aps: {
          sound: 'default',
          ...(tag ? { 'thread-id': tag } : {}),
          ...(ringing ? { 'interruption-level': 'time-sensitive' } : {}),
        },
      },
    },
  };
}
