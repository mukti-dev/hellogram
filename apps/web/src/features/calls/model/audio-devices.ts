import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeStorage } from '../../../shared/safe-storage.js';

/** Call audio choices, per device (a laptop and a phone have different microphones). */
interface AudioPrefs {
  /** null = the system default. */
  micId: string | null;
  speakerId: string | null;
  noiseCancellation: boolean;
  setMic: (id: string | null) => void;
  setSpeaker: (id: string | null) => void;
  setNoiseCancellation: (on: boolean) => void;
}

export const useAudioPrefs = create<AudioPrefs>()(
  persist(
    (set) => ({
      micId: null,
      speakerId: null,
      noiseCancellation: true,
      setMic: (micId) => set({ micId }),
      setSpeaker: (speakerId) => set({ speakerId }),
      setNoiseCancellation: (noiseCancellation) => set({ noiseCancellation }),
    }),
    { name: 'hg-call-audio', storage: safeStorage },
  ),
);

export interface AudioDevice {
  id: string;
  label: string;
}

/**
 * Choosing where call audio plays needs HTMLMediaElement.setSinkId: desktop Chrome/Edge/Firefox
 * and Android Chrome have it; iPhone browsers don't (iOS routes audio itself — Control Center).
 */
export const outputSelectionSupported = () =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

const named = (devices: MediaDeviceInfo[], kind: MediaDeviceKind, fallback: string): AudioDevice[] =>
  devices
    .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));

/** Microphones and speakers, kept current as headsets are plugged in or connected. */
export function useAudioDevices(): { inputs: AudioDevice[]; outputs: AudioDevice[] } {
  const [devices, setDevices] = useState<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>({ inputs: [], outputs: [] });
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let alive = true;
    const refresh = () =>
      void media
        .enumerateDevices()
        .then((all) => alive && setDevices({ inputs: named(all, 'audioinput', 'Microphone'), outputs: named(all, 'audiooutput', 'Speaker') }))
        .catch(() => undefined);
    refresh();
    media.addEventListener('devicechange', refresh);
    return () => {
      alive = false;
      media.removeEventListener('devicechange', refresh);
    };
  }, []);
  return devices;
}
