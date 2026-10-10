import { useSoundPrefs } from '../../../core/sound/sound-prefs.js';
import { startRingback, startRingtone } from '../../../core/sound/tones.js';
import { useCallStore } from './call-store.js';

/**
 * Ringtone while a call rings in, ringback while mine rings out; silence in every other phase.
 * Numbers on Do-not-disturb never ring here — the server drops those calls before they reach us.
 */
let stop: (() => void) | null = null;
let current: string | null = null;

useCallStore.subscribe((state) => {
  // The ringback waits for the server's answer: it says which caller tune the other number has.
  const ringback = state.phase === 'outgoing' && state.callerTune !== undefined;
  const want = state.phase === 'incoming' ? 'ring' : ringback ? `ringback:${state.callerTune ?? ''}` : null;
  if (want === current) return;
  stop?.();
  stop = null;
  current = want;
  if (want === 'ring') {
    const { ringtone, vibrate } = useSoundPrefs.getState();
    stop = startRingtone(state.ringtone ?? ringtone, vibrate);
  } else if (ringback) {
    stop = startRingback(state.callerTune ?? null);
  }
});
