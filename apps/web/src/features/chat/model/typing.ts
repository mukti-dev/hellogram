import { create } from 'zustand';

const SHOW_MS = 4000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** conversationId → whose "typing…" is showing. Clears itself after 4 s without a new event. */
export const useTypingStore = create<{ typing: Record<string, boolean>; mark: (id: string) => void }>()((set) => ({
  typing: {},
  mark: (id) => {
    clearTimeout(timers.get(id));
    set((s) => ({ typing: { ...s.typing, [id]: true } }));
    timers.set(
      id,
      setTimeout(() => set((s) => ({ typing: { ...s.typing, [id]: false } })), SHOW_MS),
    );
  },
}));
