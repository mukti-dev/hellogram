import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '../../shared/safe-storage.js';

export const RINGTONES = ['classic', 'chime', 'marimba', 'pulse', 'silent'] as const;
export type Ringtone = (typeof RINGTONES)[number];

export const MESSAGE_TONES = ['pop', 'ding', 'none'] as const;
export type MessageTone = (typeof MESSAGE_TONES)[number];

interface SoundPrefs {
  ringtone: Ringtone;
  messageTone: MessageTone;
  vibrate: boolean;
  setRingtone: (ringtone: Ringtone) => void;
  setMessageTone: (tone: MessageTone) => void;
  setVibrate: (vibrate: boolean) => void;
}

/** Per device, like a phone's sound settings (a laptop and a phone can ring differently). */
export const useSoundPrefs = create<SoundPrefs>()(
  persist(
    (set) => ({
      ringtone: 'classic',
      messageTone: 'pop',
      vibrate: true,
      setRingtone: (ringtone) => set({ ringtone }),
      setMessageTone: (messageTone) => set({ messageTone }),
      setVibrate: (vibrate) => set({ vibrate }),
    }),
    { name: 'hg-sounds', storage: safeStorage },
  ),
);
