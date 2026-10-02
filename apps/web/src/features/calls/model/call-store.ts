import type { CallSignal, IncomingCallEvent } from '@hellogram/shared';
import { create } from 'zustand';
import { ApiError } from '../../../core/http/api-error.js';
import { getSocket } from '../../../core/realtime/socket.js';
import { CallEngine, type IceServerConfig, type SignalKind } from '../../../core/webrtc/call-engine.js';
import { callsApi } from '../api/calls.api.js';
import { useAudioPrefs } from './audio-devices.js';

export interface CallParty {
  name: string;
  avatarUrl: string | null;
  labelIcon: string;
  labelName: string | null;
  /** Their code (outgoing) or mine (incoming "to A482719K"). */
  code: string | null;
}

type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

interface CallState {
  phase: Phase;
  callId: string | null;
  direction: 'incoming' | 'outgoing' | null;
  party: CallParty | null;
  locked: boolean;
  startedAt: number | null;
  muted: boolean;
  /** RNNoise is running (false while off, or where the browser can't run it). */
  noiseCancellationActive: boolean;
  endedLabel: string | null;
  error: string | null;
  startOutgoing: (conversationId: string, party: CallParty) => Promise<void>;
  receiveIncoming: (event: IncomingCallEvent, party: CallParty) => void;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => void;
  selectMicrophone: (id: string | null) => Promise<void>;
  selectSpeaker: (id: string | null) => Promise<void>;
  setNoiseCancellation: (on: boolean) => Promise<void>;
  onRemoteEnded: (callId: string, reason: string) => void;
  onAccepted: (callId: string) => void;
  onSignal: (signal: CallSignal) => void;
}

let engine: CallEngine | null = null;
/**
 * The microphone is attached. Until then signals wait in the queue: answering an offer before the
 * track is added makes a receive-only answer, and the other side never hears us (one-way audio).
 */
let micReady: Promise<void> | null = null;
let ready = false;
let queuedSignals: CallSignal[] = [];
let ringTimer: ReturnType<typeof setTimeout> | undefined;
let connectTimer: ReturnType<typeof setTimeout> | undefined;

/** Media must be flowing this soon after the call is accepted, or we give up (e.g. TURN relay unreachable). */
const CONNECT_TIMEOUT_MS = 20_000;

const aborted = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const sendSignal = (callId: string) => (kind: SignalKind, data: Record<string, unknown>) =>
  getSocket()?.emit('call:signal', { callId, kind, data });

function teardown() {
  clearTimeout(ringTimer);
  clearTimeout(connectTimer);
  engine?.close();
  engine = null;
  micReady = null;
  ready = false;
  queuedSignals = [];
}

const IDLE = {
  phase: 'idle' as Phase,
  callId: null,
  direction: null,
  party: null,
  locked: false,
  startedAt: null,
  muted: false,
  noiseCancellationActive: false,
  endedLabel: null,
  error: null,
};

export const useCallStore = create<CallState>()((set, get) => {
  const finish = (label: string) => {
    teardown();
    set({ phase: 'ended', endedLabel: label });
    setTimeout(() => {
      if (get().phase === 'ended') set(IDLE);
    }, 1800);
  };

  const startConnectTimeout = (callId: string) => {
    clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      if (get().callId !== callId || get().phase !== 'connecting') return;
      void callsApi.end(callId).catch(() => undefined);
      finish('Couldn’t connect the call');
    }, CONNECT_TIMEOUT_MS);
  };

  const makeEngine = async (callId: string, iceServers: IceServerConfig[]) => {
    engine = new CallEngine(iceServers, sendSignal(callId), (state) => {
      if (state === 'connected' && get().callId === callId) {
        clearTimeout(connectTimer);
        // A brief network blip can report "connected" again: keep the original start time.
        set({ phase: 'active', startedAt: get().startedAt ?? Date.now() });
      }
      if (state === 'failed' && get().callId === callId) {
        void callsApi.end(callId).catch(() => undefined);
        finish('Call failed');
      }
    });
    const current = engine;
    const { micId, speakerId, noiseCancellation } = useAudioPrefs.getState();
    micReady = current.openMicrophone({ micId, speakerId, noiseCancellation });
    await micReady;
    if (engine !== current) return; // the call ended while the microphone was opening
    ready = true;
    set({ noiseCancellationActive: current.noiseCancellationActive });
    const queued = queuedSignals.filter((q) => q.callId === callId);
    queuedSignals = [];
    for (const s of queued) await current.handleSignal(s.kind, s.data);
  };

  return {
    ...IDLE,

    async startOutgoing(conversationId, party) {
      if (get().phase !== 'idle') return;
      set({ ...IDLE, phase: 'outgoing', direction: 'outgoing', party });
      try {
        const res = await callsApi.start(conversationId);
        set({ callId: res.callId });
        await makeEngine(res.callId, res.iceServers);
        // Our own ring-out timer mirrors the server's 45 s timeout.
        ringTimer = setTimeout(() => {
          if (get().phase === 'outgoing') finish('No answer');
        }, res.ringSeconds * 1000 + 2000);
      } catch (error) {
        if (aborted(error)) return; // hung up while the microphone was opening: already handled
        const callId = get().callId;
        if (callId) void callsApi.end(callId).catch(() => undefined);
        teardown();
        set({
          ...IDLE,
          phase: 'ended',
          party,
          endedLabel:
            error instanceof DOMException
              ? 'Microphone access is needed for calls'
              : error instanceof ApiError
                ? error.message
                : 'Call failed',
        });
        setTimeout(() => get().phase === 'ended' && set(IDLE), 2500);
      }
    },

    receiveIncoming(event, party) {
      // Already busy on this device: the server treats us as busy, nothing to show.
      if (get().phase !== 'idle') return;
      set({ ...IDLE, phase: 'incoming', direction: 'incoming', callId: event.callId, party, locked: event.caller === null });
    },

    async accept() {
      const { callId } = get();
      if (!callId) return;
      set({ phase: 'connecting' });
      startConnectTimeout(callId);
      try {
        const res = await callsApi.accept(callId);
        await makeEngine(callId, res.iceServers);
      } catch (error) {
        if (aborted(error)) return;
        void callsApi.end(callId).catch(() => undefined);
        finish(error instanceof DOMException ? 'Microphone access is needed for calls' : 'Call ended');
      }
    },

    async decline() {
      const { callId } = get();
      if (callId) await callsApi.decline(callId).catch(() => undefined);
      teardown();
      set(IDLE);
    },

    async hangUp() {
      const { callId } = get();
      if (callId) await callsApi.end(callId).catch(() => undefined);
      finish('Call ended');
    },

    toggleMute() {
      const muted = !get().muted;
      engine?.setMuted(muted);
      set({ muted });
    },

    async selectMicrophone(id) {
      useAudioPrefs.getState().setMic(id);
      await engine?.setMicrophone(id, useAudioPrefs.getState().noiseCancellation);
      if (engine) set({ noiseCancellationActive: engine.noiseCancellationActive });
    },

    async selectSpeaker(id) {
      useAudioPrefs.getState().setSpeaker(id);
      await engine?.setSpeaker(id);
    },

    async setNoiseCancellation(on) {
      useAudioPrefs.getState().setNoiseCancellation(on);
      await engine?.setNoiseCancellation(on);
      if (engine) set({ noiseCancellationActive: engine.noiseCancellationActive });
    },

    onAccepted(callId) {
      if (get().callId !== callId || get().phase !== 'outgoing') return;
      clearTimeout(ringTimer);
      set({ phase: 'connecting' });
      startConnectTimeout(callId);
      // Offer only once our microphone is attached, or the offer carries no audio from us.
      const pending = micReady;
      void (async () => {
        await pending?.catch(() => undefined);
        if (ready && get().callId === callId) await engine?.createOffer();
      })();
    },

    onRemoteEnded(callId, reason) {
      const { callId: current, phase } = get();
      if (current !== callId) return;
      if (reason === 'answered_elsewhere') {
        // Another of my devices picked up; only a still-ringing device stops.
        if (phase === 'incoming') {
          teardown();
          set(IDLE);
        }
        return;
      }
      if (phase === 'incoming') {
        teardown();
        set(IDLE);
        return;
      }
      finish(reason === 'completed' ? 'Call ended' : 'No answer');
    },

    onSignal(signal) {
      if (signal.callId !== get().callId) return;
      if (engine && ready) void engine.handleSignal(signal.kind, signal.data);
      else queuedSignals.push(signal);
    },
  };
});
