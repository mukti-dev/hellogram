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

export type SignalKind = 'offer' | 'answer' | 'ice';
export type EngineState = 'new' | 'connecting' | 'connected' | 'failed' | 'closed';

export class CallEngine {
  private readonly pc: RTCPeerConnection;
  private localStream: MediaStream | null = null;
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
  async openMicrophone(): Promise<void> {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    for (const track of this.localStream.getTracks()) this.pc.addTrack(track, this.localStream);
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
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !muted;
  }

  close(): void {
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.pc.close();
    this.audio.srcObject = null;
  }

  private async flushIce() {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) await this.pc.addIceCandidate(c).catch(() => undefined);
  }
}
