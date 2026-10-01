import { create } from 'zustand';
import { configureHttp } from '../../../core/http/client.js';

type Status = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  /** Kept in memory only — never in localStorage. The refresh cookie restores it on reload. */
  accessToken: string | null;
  status: Status;
  signIn: (accessToken: string) => void;
  signOut: () => void;
  setAnonymous: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  status: 'unknown',
  signIn: (accessToken) => set({ accessToken, status: 'authenticated' }),
  signOut: () => {
    // Nothing from the previous user stays on the device: unsent messages, unlock tokens, decrypted files.
    void import('../../chat/model/outbox.js').then((m) => m.useOutbox.getState().clear());
    void import('../../pin/model/unlock-tokens.js').then((m) => m.useUnlockTokens.getState().clear());
    void import('../../chat/model/attachments.js').then((m) => m.clearAttachmentCache());
    set({ accessToken: null, status: 'anonymous' });
  },
  setAnonymous: () => set({ accessToken: null, status: 'anonymous' }),
}));

configureHttp({
  getAccessToken: () => useAuthStore.getState().accessToken,
  setAccessToken: (token) =>
    token ? useAuthStore.getState().signIn(token) : useAuthStore.getState().setAnonymous(),
  onSessionEnded: () => useAuthStore.getState().signOut(),
});
