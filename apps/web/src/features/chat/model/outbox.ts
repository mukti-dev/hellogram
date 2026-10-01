import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Offline outbox (§10): outgoing messages are kept until the server confirms them,
 * and retried on reconnect. The server is idempotent on clientMessageId, so a
 * retry after a lost response can never create a duplicate.
 */
export interface OutboxItem {
  clientMessageId: string;
  conversationId: string;
  body: string;
  createdAt: string;
  state: 'sending' | 'queued' | 'failed';
  error?: string;
}

interface OutboxState {
  items: OutboxItem[];
  add: (item: OutboxItem) => void;
  update: (clientMessageId: string, patch: Partial<OutboxItem>) => void;
  remove: (clientMessageId: string) => void;
  clear: () => void;
}

const storage = createJSONStorage(() => {
  try {
    window.localStorage.setItem('__hg__', '1');
    window.localStorage.removeItem('__hg__');
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
});

export const useOutbox = create<OutboxState>()(
  persist(
    (set) => ({
      items: [],
      add: (item) => set((s) => ({ items: [...s.items, item] })),
      update: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.clientMessageId === id ? { ...i, ...patch } : i)) })),
      remove: (id) => set((s) => ({ items: s.items.filter((i) => i.clientMessageId !== id) })),
      clear: () => set({ items: [] }),
    }),
    { name: 'hg-outbox', storage },
  ),
);

export const newClientMessageId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
