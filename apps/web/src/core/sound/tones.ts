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

interface Note {
  /** Frequencies played together (Hz). */
  f: number[];
  /** Start offset within the pattern (s). */
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

interface Pattern {
  notes: Note[];
  /** Pattern length before it repeats (s). */
  period: number;
}

const RINGTONE_PATTERNS: Record<Exclude<Ringtone, 'silent'>, Pattern> = {
  // Two-burst phone ring.
  classic: {
    period: 3,
    notes: [
      { f: [440, 480], at: 0, dur: 0.4, gain: 0.12 },
      { f: [440, 480], at: 0.6, dur: 0.4, gain: 0.12 },
    ],
  },
  chime: {
    period: 2.4,
    notes: [
      { f: [659.25], at: 0, dur: 0.5, type: 'triangle', gain: 0.25 },
      { f: [783.99], at: 0.25, dur: 0.5, type: 'triangle', gain: 0.25 },
      { f: [1046.5], at: 0.5, dur: 0.9, type: 'triangle', gain: 0.25 },
    ],
  },
  marimba: {
    period: 2,
    notes: [523.25, 659.25, 783.99, 659.25, 880, 783.99].map((f, i) => ({ f: [f], at: i * 0.16, dur: 0.22, gain: 0.3 })),
  },
  pulse: {
    period: 1.6,
    notes: [0, 0.2, 0.4].map((at) => ({ f: [880], at, dur: 0.1, type: 'square' as const, gain: 0.05 })),
  },
};

/** Indian ringback (what the caller hears): 400+450 Hz, 0.4 on / 0.2 off / 0.4 on / 2.0 off. */
const RINGBACK: Pattern = {
  period: 3,
  notes: [
    { f: [400, 450], at: 0, dur: 0.4, gain: 0.05 },
    { f: [400, 450], at: 0.6, dur: 0.4, gain: 0.05 },
  ],
};

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

export function startRingback(): () => void {
  return loop(RINGBACK);
}

export function playMessageTone(tone: MessageTone, vibrate: boolean): void {
  if (vibrate && 'vibrate' in navigator) navigator.vibrate(120);
  if (tone === 'none') return;
  const context = audio();
  if (context) schedule(context, context.destination, MESSAGE_PATTERNS[tone], context.currentTime + 0.02);
}

/** Settings preview: a few seconds of the ringtone. */
export function previewRingtone(ringtone: Ringtone): () => void {
  const stop = startRingtone(ringtone, false);
  const timer = setTimeout(stop, 3000);
  return () => {
    clearTimeout(timer);
    stop();
  };
}
