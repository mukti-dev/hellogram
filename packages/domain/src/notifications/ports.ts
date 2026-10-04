export interface PushPayload {
  title: string;
  body: string;
  /** App URL to open when tapped. */
  url: string;
  /** Collapses repeated notifications (e.g. one per chat). */
  tag?: string;
  /**
   * Call notifications: "call" rings with Accept/Decline until answered; "call_ended" and
   * "call_answered" replace it (a missed call stays as "Missed call", the rest just clear it).
   */
  kind?: 'call' | 'call_ended' | 'call_answered';
  callId?: string;
  /** Lets the notification's Decline button refuse this one ringing call without a session. */
  declineToken?: string;
  /** Shown as "Missed call…" (true) or cleared quietly (false). */
  missed?: boolean;
  /** Drop the push if it can't be delivered in time (a call rings for 45 s). Default 1 hour. */
  ttlSeconds?: number;
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRepository {
  upsert(input: { accountId: string; sessionId: string; endpoint: string; p256dh: string; auth: string }): Promise<void>;
  remove(accountId: string, endpoint: string): Promise<void>;
  listForAccount(accountId: string): Promise<PushSubscriptionRecord[]>;
  deleteById(id: string): Promise<void>;
}

export interface PushSender {
  /** Returns 'gone' when the browser subscription no longer exists (404/410). */
  send(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<'ok' | 'gone'>;
}

/** A phone's push token (mobile app). iOS: "voip" rings CallKit, "alert" is everything else. */
export interface NativePushTokenRecord {
  id: string;
  platform: 'ios' | 'android';
  kind: 'voip' | 'alert';
  token: string;
}

export interface NativePushTokenRepository {
  /** A token moves to whoever registers it last (a phone can switch accounts). */
  upsert(input: { accountId: string; sessionId: string; platform: 'ios' | 'android'; kind: 'voip' | 'alert'; token: string }): Promise<void>;
  remove(accountId: string, token: string): Promise<void>;
  /** Only tokens whose session is still active: a logged-out phone gets nothing. */
  listForAccount(accountId: string, now: Date): Promise<NativePushTokenRecord[]>;
  deleteById(id: string): Promise<void>;
}

/** APNs / FCM delivery. Returns 'gone' when the token is no longer valid. */
export interface NativePushSender {
  send(token: NativePushTokenRecord, payload: PushPayload): Promise<'ok' | 'gone'>;
}
