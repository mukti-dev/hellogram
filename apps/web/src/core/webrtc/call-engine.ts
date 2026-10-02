/**
 * Framework-free WebRTC audio engine (reusable by React Native later).
 * iceTransportPolicy is always "relay": media only flows through our TURN
 * server, so neither side ever learns the other's IP address.
 */
export interface IceServerConfig {
  urls: string[];
  username: string;
  credential: string;
}

import { cancelNoise, noiseCancellationSupported, type ProcessedMic } from './noise-suppression.js';

export type SignalKind = 'offer' | 'answer' | 'ice';
export type EngineState = 'new' | 'connecting' | 'connected' | 'failed' | 'closed';

export interface AudioSettings {
  /** Microphone deviceId; null = the system default. */
  micId: string | null;
  /** Output deviceId (where supported); null = the system default. */
  speakerId: string | null;
  /** RNNoise on top of the browser's own noise suppression. */
  noiseCancellation: boolean;
}

export class CallEngine {
  private readonly pc: RTCPeerConnection;
  /** The raw microphone. */
  private mic: MediaStreamTrack | null = null;
  /** The noise-cancelled copy of it, when on. */
  private processed: ProcessedMic | null = null;
  private sender: RTCRtpSender | null = null;
  private muted = false;
  private readonly audio: HTMLAudioElement;
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(
    iceServers: IceServerConfig[],
    private readonly send: (kind: SignalKind, data: Record<string, unknown>) => void,
    private readonly onState: (state: EngineState) => void,
  ) {
    this.pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
    if (import.meta.env.DEV) {
      const w = window as unknown as { __hgPeers?: RTCPeerConnection[] };
      w.__hgPeers = [...(w.__hgPeers ?? []), this.pc];
    }
    this.audio = new Audio();
    this.audio.autoplay = true;

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.send('ice', e.candidate.toJSON() as Record<string, unknown>);
    };
    this.pc.ontrack = (e) => {
      this.audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void this.audio.play().catch(() => undefined);
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      this.onState(s === 'connected' ? 'connected' : s === 'failed' ? 'failed' : s === 'closed' ? 'closed' : 'connecting');
    };
  }

  /** Asks for the microphone. Throws if the user denies it. */
  async openMicrophone(settings: AudioSettings): Promise<void> {
    this.mic = await this.captureMic(settings.micId);
    const track = await this.outgoing(settings.noiseCancellation);
    this.sender = this.pc.addTrack(track, new MediaStream([track]));
    await this.setSpeaker(settings.speakerId);
  }

  /** Switches microphone mid-call (e.g. to a headset) without renegotiating. */
  async setMicrophone(micId: string | null, noiseCancellation: boolean): Promise<void> {
    const next = await this.captureMic(micId);
    const old = this.mic;
    this.mic = next;
    await this.replaceOutgoing(noiseCancellation);
    old?.stop();
  }

  async setNoiseCancellation(on: boolean): Promise<void> {
    if (this.mic) await this.replaceOutgoing(on);
  }

  /** Where the other person's voice plays. Ignored where the browser can't choose. */
  async setSpeaker(speakerId: string | null): Promise<void> {
    const audio = this.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (!audio.setSinkId) return;
    await audio.setSinkId(speakerId ?? '').catch(() => undefined);
  }

  /** Whether RNNoise is actually running (it falls back silently where unsupported). */
  get noiseCancellationActive(): boolean {
    return this.processed !== null;
  }

  private async captureMic(micId: string | null): Promise<MediaStreamTrack> {
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    const ask = (constraints: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
    // A remembered headset may be gone: fall back to the default microphone.
    const stream = await (micId ? ask({ ...audio, deviceId: { exact: micId } }).catch(() => ask(audio)) : ask(audio));
    const [track] = stream.getAudioTracks();
    if (!track) throw new DOMException('No microphone', 'NotFoundError');
    track.enabled = !this.muted;
    return track;
  }

  /** The track to send: the microphone, or its noise-cancelled copy. */
  private async outgoing(noiseCancellation: boolean): Promise<MediaStreamTrack> {
    this.processed?.dispose();
    this.processed = null;
    const mic = this.mic!;
    if (noiseCancellation && noiseCancellationSupported()) {
      this.processed = await cancelNoise(mic).catch(() => null);
    }
    const track = this.processed?.track ?? mic;
    track.enabled = !this.muted;
    return track;
  }

  private async replaceOutgoing(noiseCancellation: boolean): Promise<void> {
    const previous = this.processed;
    this.processed = null; // keep the old graph alive until the new track is swapped in
    const track = await this.outgoing(noiseCancellation);
    await this.sender?.replaceTrack(track);
    previous?.dispose();
  }

  /** Caller side, once the callee accepted. */
  async createOffer(): Promise<void> {
    const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
    await this.pc.setLocalDescription(offer);
    this.send('offer', { type: offer.type, sdp: offer.sdp ?? '' });
  }

  async handleSignal(kind: SignalKind, data: Record<string, unknown>): Promise<void> {
    if (kind === 'offer') {
      await this.pc.setRemoteDescription(data as unknown as RTCSessionDescriptionInit);
      await this.flushIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.send('answer', { type: answer.type, sdp: answer.sdp ?? '' });
    } else if (kind === 'answer') {
      await this.pc.setRemoteDescription(data as unknown as RTCSessionDescriptionInit);
      await this.flushIce();
    } else if (this.pc.remoteDescription) {
      await this.pc.addIceCandidate(data as RTCIceCandidateInit).catch(() => undefined);
    } else {
      this.pendingIce.push(data as RTCIceCandidateInit);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.mic) this.mic.enabled = !muted;
    if (this.processed) this.processed.track.enabled = !muted;
  }

  close(): void {
    this.processed?.dispose();
    this.processed = null;
    this.mic?.stop();
    this.mic = null;
    this.pc.close();
    this.audio.srcObject = null;
  }

  private async flushIce() {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) await this.pc.addIceCandidate(c).catch(() => undefined);
  }
}
