/**
 * Services publish domain events here. An infrastructure adapter turns them into
 * Socket.IO emits and push jobs, so services never depend on transport details.
 */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  type: TType;
  payload: TPayload;
  occurredAt: Date;
}

export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
