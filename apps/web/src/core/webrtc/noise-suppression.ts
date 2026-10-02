/**
 * Stronger noise cancellation than the browser's own: RNNoise (a small neural network, run as
 * WebAssembly in an AudioWorklet) between the microphone and the call. Loaded only when a call
 * starts. If anything is unsupported, the call goes on with the browser's noise suppression.
 */
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';

export interface ProcessedMic {
  /** The track to send. */
  track: MediaStreamTrack;
  /** Releases the audio graph (never stops the microphone itself). */
  dispose: () => void;
}

let wasm: Promise<ArrayBuffer> | null = null;

export const noiseCancellationSupported = () =>
  typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && typeof WebAssembly !== 'undefined';

/** RNNoise expects 48 kHz mono, which is also what Opus sends. */
export async function cancelNoise(mic: MediaStreamTrack): Promise<ProcessedMic> {
  const { loadRnnoise, RnnoiseWorkletNode } = await import('@sapphi-red/web-noise-suppressor');
  wasm ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl }).catch((error: unknown) => {
    wasm = null;
    throw error;
  });
  const ctx = new AudioContext({ sampleRate: 48_000 });
  try {
    const [binary] = await Promise.all([wasm, ctx.audioWorklet.addModule(rnnoiseWorkletUrl)]);
    const source = ctx.createMediaStreamSource(new MediaStream([mic]));
    const denoiser = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary });
    const out = ctx.createMediaStreamDestination();
    source.connect(denoiser).connect(out);
    // A context created outside a tap can start suspended (mobile Safari).
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    const [track] = out.stream.getAudioTracks();
    if (!track) throw new Error('No processed track');
    return {
      track,
      dispose: () => {
        track.stop();
        source.disconnect();
        denoiser.disconnect();
        denoiser.destroy();
        void ctx.close().catch(() => undefined);
      },
    };
  } catch (error) {
    void ctx.close().catch(() => undefined);
    throw error;
  }
}
