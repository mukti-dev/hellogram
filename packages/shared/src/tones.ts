/**
 * Built-in Hellogram tones, the same on the website and in the app. They're described as notes
 * (no audio files to license): the website plays them with Web Audio, the app ships them rendered
 * to short WAV loops (hellogram-rn/scripts/gen-tones.mjs).
 */

/** What rings when I'm called. Chosen per device, per number and per chat (the most specific wins). */
export const RINGTONES = ['classic', 'chime', 'marimba', 'pulse', 'silent'] as const;
export type Ringtone = (typeof RINGTONES)[number];

/** What callers hear while my number rings ("caller tune"). Chosen per number. */
export const CALLER_TUNES = ['standard', 'melody', 'bells', 'calm'] as const;
export type CallerTune = (typeof CALLER_TUNES)[number];

/** A stored tone name, or null when it isn't one of today's tones (e.g. removed later). */
export const ringtoneOrNull = (name: string | null | undefined): Ringtone | null =>
  (RINGTONES as readonly string[]).includes(name ?? '') ? (name as Ringtone) : null;
export const callerTuneOrNull = (name: string | null | undefined): CallerTune | null =>
  (CALLER_TUNES as readonly string[]).includes(name ?? '') ? (name as CallerTune) : null;

export interface ToneNote {
  /** Frequencies played together (Hz). */
  f: number[];
  /** Start offset within the pattern (s). */
  at: number;
  dur: number;
  type?: 'sine' | 'triangle' | 'square';
  gain?: number;
}

export interface TonePattern {
  notes: ToneNote[];
  /** Pattern length before it repeats (s). */
  period: number;
}

export const RINGTONE_PATTERNS: Record<Exclude<Ringtone, 'silent'>, TonePattern> = {
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

export const CALLER_TUNE_PATTERNS: Record<CallerTune, TonePattern> = {
  // Indian ringback: 400+450 Hz, 0.4 on / 0.2 off / 0.4 on / 2.0 off.
  standard: {
    period: 3,
    notes: [
      { f: [400, 450], at: 0, dur: 0.4, gain: 0.05 },
      { f: [400, 450], at: 0.6, dur: 0.4, gain: 0.05 },
    ],
  },
  // A gentle rising and falling arpeggio.
  melody: {
    period: 3.2,
    notes: [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25].map((f, i) => ({ f: [f], at: i * 0.3, dur: 0.55, gain: 0.12 })),
  },
  bells: {
    period: 3,
    notes: [
      { f: [1046.5, 2093], at: 0, dur: 1.2, type: 'triangle', gain: 0.1 },
      { f: [1318.5, 2637], at: 0.5, dur: 1.2, type: 'triangle', gain: 0.1 },
      { f: [783.99, 1568], at: 1.0, dur: 1.6, type: 'triangle', gain: 0.1 },
    ],
  },
  // Two soft, long chords.
  calm: {
    period: 4,
    notes: [
      { f: [261.63, 329.63, 392], at: 0, dur: 1.8, gain: 0.06 },
      { f: [220, 277.18, 329.63], at: 2, dur: 1.8, gain: 0.06 },
    ],
  },
};
