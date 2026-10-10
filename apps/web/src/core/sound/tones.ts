import { CALLER_TUNE_PATTERNS, RINGTONE_PATTERNS, type CallerTune, type TonePattern } from '@hellogram/shared';
import type { MessageTone, Ringtone } from './sound-prefs.js';

/**
 * Tones are synthesised with Web Audio — no audio files to ship, license or cache.
 * Browsers only allow sound after a user gesture, so the context is unlocked on the first tap/key.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

export function unlockAudioOnFirstGesture(): void {
  const unlock = () => {
    audio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

type Pattern = TonePattern;

const MESSAGE_PATTERNS: Record<Exclude<MessageTone, 'none'>, Pattern> = {
  pop: { period: 0, notes: [{ f: [880], at: 0, dur: 0.08, gain: 0.2 }, { f: [1318.5], at: 0.07, dur: 0.1, gain: 0.2 }] },
  ding: { period: 0, notes: [{ f: [1567.98], at: 0, dur: 0.6, type: 'triangle', gain: 0.25 }] },
};

function schedule(context: AudioContext, out: AudioNode, pattern: Pattern, start: number): void {
  for (const note of pattern.notes) {
    const t0 = start + note.at;
    const env = context.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(note.gain ?? 0.2, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
    env.connect(out);
    for (const f of note.f) {
      const osc = context.createOscillator();
      osc.type = note.type ?? 'sine';
      osc.frequency.value = f;
      osc.connect(env);
      osc.start(t0);
      osc.stop(t0 + note.dur + 0.05);
    }
  }
}

/** Plays a pattern on repeat until the returned function is called. */
function loop(pattern: Pattern, vibration?: number[]): () => void {
  const context = audio();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = context?.createGain();
  if (context && out) out.connect(context.destination);

  const tick = () => {
    if (stopped) return;
    if (context && out) schedule(context, out, pattern, context.currentTime + 0.02);
    if (vibration && 'vibrate' in navigator) navigator.vibrate(vibration);
    timer = setTimeout(tick, pattern.period * 1000);
  };
  tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
    out?.disconnect();
    if (vibration && 'vibrate' in navigator) navigator.vibrate(0);
  };
}

const RING_VIBRATION = [400, 200, 400];

export function startRingtone(ringtone: Ringtone, vibrate: boolean): () => void {
  if (ringtone === 'silent') return vibrate ? loop({ period: 3, notes: [] }, RING_VIBRATION) : () => undefined;
  return loop(RINGTONE_PATTERNS[ringtone], vibrate ? RING_VIBRATION : undefined);
}

/** What I hear while my call rings out: the other number's caller tune (null = the standard ringback). */
export function startRingback(tune: CallerTune | null): () => void {
  return loop(CALLER_TUNE_PATTERNS[tune ?? 'standard']);
}

export function playMessageTone(tone: MessageTone, vibrate: boolean): void {
  if (vibrate && 'vibrate' in navigator) navigator.vibrate(120);
  if (tone === 'none') return;
  const context = audio();
  if (context) schedule(context, context.destination, MESSAGE_PATTERNS[tone], context.currentTime + 0.02);
}

/** Settings preview: a few seconds of the tone. */
function preview(stop: () => void): () => void {
  const timer = setTimeout(stop, 4000);
  return () => {
    clearTimeout(timer);
    stop();
  };
}

export const previewRingtone = (ringtone: Ringtone) => preview(startRingtone(ringtone, false));
export const previewCallerTune = (tune: CallerTune) => preview(startRingback(tune));
