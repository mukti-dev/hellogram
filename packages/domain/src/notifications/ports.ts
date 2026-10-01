export interface PushPayload {
  title: string;
  body: string;
  /** App URL to open when tapped. */
  url: string;
  /** Collapses repeated notifications (e.g. one per chat). */
  tag?: string;
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
