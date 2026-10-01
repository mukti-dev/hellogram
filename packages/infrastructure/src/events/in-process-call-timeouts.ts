import type { CallTimeoutScheduler } from '@hellogram/domain';

/**
 * Per-instance ring timers. If an instance dies mid-ring, the worker's
 * stale-ringing sweep marks the call missed.
 */
export class InProcessCallTimeouts implements CallTimeoutScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly onTimeout: (callId: string) => Promise<void>) {}

  schedule(callId: string, delayMs: number): void {
    this.cancel(callId);
    this.timers.set(
      callId,
      setTimeout(() => {
        this.timers.delete(callId);
        void this.onTimeout(callId).catch(() => undefined);
      }, delayMs),
    );
  }

  cancel(callId: string): void {
    const timer = this.timers.get(callId);
    if (timer) clearTimeout(timer);
    this.timers.delete(callId);
  }
}
