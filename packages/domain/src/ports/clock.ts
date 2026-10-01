/** Injected so time-based rules (expiry, cool-downs, lockouts) are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
