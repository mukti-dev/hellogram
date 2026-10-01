import { useSoundPrefs } from '../../../core/sound/sound-prefs.js';
import { startRingback, startRingtone } from '../../../core/sound/tones.js';
import { useCallStore } from './call-store.js';

/**
 * Ringtone while a call rings in, ringback while mine rings out; silence in every other phase.
 * Numbers on Do-not-disturb never ring here — the server drops those calls before they reach us.
 */
let stop: (() => void) | null = null;
let current: 'ring' | 'ringback' | null = null;

useCallStore.subscribe((state) => {
  const want = state.phase === 'incoming' ? 'ring' : state.phase === 'outgoing' ? 'ringback' : null;
  if (want === current) return;
  stop?.();
  stop = null;
  current = want;
  if (want === 'ring') {
    const { ringtone, vibrate } = useSoundPrefs.getState();
    stop = startRingtone(ringtone, vibrate);
  } else if (want === 'ringback') {
    stop = startRingback();
  }
});
