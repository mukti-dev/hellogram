import { create } from 'zustand';

/** Which locked number the unlock screen is showing (null = closed). */
export const useUnlockUi = create<{ personaId: string | null; open: (id: string) => void; close: () => void }>()((set) => ({
  personaId: null,
  open: (personaId) => set({ personaId }),
  close: () => set({ personaId: null }),
}));

export const openUnlock = (personaId: string) => useUnlockUi.getState().open(personaId);
