import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '../../shared/safe-storage.js';

export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: 'system',
      setPreference: (preference) => set({ preference }),
    }),
    { name: 'hg-theme', storage: safeStorage },
  ),
);

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && prefersDark().matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Keeps `<html data-theme>` in sync with the preference and the OS setting. */
export function startThemeSync(): () => void {
  applyTheme(useThemeStore.getState().preference);
  const unsubscribe = useThemeStore.subscribe((state) => applyTheme(state.preference));
  const media = prefersDark();
  const onChange = () => applyTheme(useThemeStore.getState().preference);
  media.addEventListener('change', onChange);
  return () => {
    unsubscribe();
    media.removeEventListener('change', onChange);
  };
}
