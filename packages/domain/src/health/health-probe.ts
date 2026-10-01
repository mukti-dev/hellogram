export type ProbeStatus = 'ok' | 'down';

/** A dependency the app needs to be healthy (database, Redis, …). */
export interface HealthProbe {
  readonly name: string;
  check(): Promise<ProbeStatus>;
}
