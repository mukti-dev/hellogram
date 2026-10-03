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
