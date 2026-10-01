import { useSyncExternalStore } from 'react';

/**
 * Current time, re-rendering every `intervalMs`. Keeps Date.now() out of render
 * (pure components) while still updating timers and "within 60 minutes" checks.
 */
const stores = new Map<number, { now: number; subscribe: (cb: () => void) => () => void }>();

function storeFor(intervalMs: number) {
  let store = stores.get(intervalMs);
  if (!store) {
    const listeners = new Set<() => void>();
    let timer: ReturnType<typeof setInterval> | undefined;
    const s = {
      now: Date.now(),
      subscribe(cb: () => void) {
        listeners.add(cb);
        if (!timer) {
          timer = setInterval(() => {
            s.now = Date.now();
            for (const l of listeners) l();
          }, intervalMs);
        }
        return () => {
          listeners.delete(cb);
          if (listeners.size === 0 && timer) {
            clearInterval(timer);
            timer = undefined;
          }
        };
      },
    };
    store = s;
    stores.set(intervalMs, s);
  }
  return store;
}

export function useNow(intervalMs = 30_000): number {
  const store = storeFor(intervalMs);
  return useSyncExternalStore(store.subscribe, () => store.now);
}
