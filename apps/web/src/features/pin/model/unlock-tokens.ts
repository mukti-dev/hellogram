import { create } from 'zustand';
import { configureExtraHeaders } from '../../../core/http/client.js';

/**
 * Unlock tokens live in memory only: closing the tab drops them (rule 25),
 * and they're discarded after 1 minute in the background.
 */
interface TokenState {
  tokens: Record<string, string>;
  set: (personaId: string, token: string) => void;
  clear: () => void;
}

export const useUnlockTokens = create<TokenState>()((set) => ({
  tokens: {},
  set: (personaId, token) => set((s) => ({ tokens: { ...s.tokens, [personaId]: token } })),
  clear: () => set({ tokens: {} }),
}));

configureExtraHeaders((): Record<string, string> => {
  const tokens = Object.values(useUnlockTokens.getState().tokens);
  return tokens.length ? { 'X-Persona-Unlock': tokens.join(',') } : {};
});

const BACKGROUND_LIMIT_MS = 60_000;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Call once at startup. */
export function startUnlockExpiry(onExpire: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      timer = setTimeout(() => {
        if (Object.keys(useUnlockTokens.getState().tokens).length) {
          useUnlockTokens.getState().clear();
          onExpire();
        }
      }, BACKGROUND_LIMIT_MS);
    } else {
      clearTimeout(timer);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
}
