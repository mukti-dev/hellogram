import type { PushPayload } from '@hellogram/domain';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const NOTIFY_QUEUE = 'notify';
export const BULL_PREFIX = 'hg:bull';

/** API side: enqueue push notifications for the worker to deliver. */
export class NotificationQueue {
  private readonly queue: Queue;

  constructor(connection: Redis) {
    this.queue = new Queue(NOTIFY_QUEUE, { connection, prefix: BULL_PREFIX });
  }

  async push(accountId: string, payload: PushPayload): Promise<void> {
    await this.queue.add('notify.push', { accountId, payload }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // Payloads can contain message previews: never keep them around after delivery.
      removeOnComplete: true,
      removeOnFail: { age: 60 * 60 },
    });
  }

  close() {
    return this.queue.close();
  }
}
