import type { DomainEvent, EventPublisher } from '@hellogram/domain';

type Handler = (event: DomainEvent) => Promise<void> | void;

/**
 * In-process event publisher. Realtime (Socket.IO) and push adapters subscribe
 * to event types; services only ever call `publish`.
 */
export class LocalEventPublisher implements EventPublisher {
  private readonly handlers = new Map<string, Handler[]>();

  subscribe(type: string, handler: Handler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    await Promise.all(handlers.map(async (handler) => handler(event)));
  }
}
