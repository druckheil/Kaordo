import type {
  RondoVoiceGateway,
  RondoVoiceParticipant,
  RondoVoiceSignal,
  RondoVoiceSync,
} from '../gateways/NodeRondoVoiceGateway';
import {
  DEFAULT_MEDIA_PREFERENCES,
  normalizeMediaPreferences,
  type MediaPreferences,
} from '../domain/mediaSettings';
import { openMicrophone } from './mediaDevices';

export type RondoVoicePeer = {
  connection: RTCPeerConnectionState | 'local';
  local: boolean;
  peerId: string;
  speaking: boolean;
  streams: MediaStream[];
  username: string;
};

export type RondoVoiceSnapshot = {
  cameraOn: boolean;
  deafened: boolean;
  error: string | null;
  muted: boolean;
  participants: RondoVoicePeer[];
  phase: 'connected' | 'error' | 'idle' | 'joining';
  screenAudio: boolean;
  screenOn: boolean;
};

type Listener = (snapshot: Readonly<RondoVoiceSnapshot>) => void;
type Peer = {
  connection: RTCPeerConnection;
  generation: number;
  ignoreOffer: boolean;
  makingOffer: boolean;
  participant: RondoVoiceParticipant;
  pendingCandidates: RTCIceCandidateInit[];
  polite: boolean;
  streams: Map<string, MediaStream>;
};
type MicrophoneCapture = {
  gain: GainNode | null;
  input: MediaStream;
  output: MediaStream;
};

export const EMPTY_RONDO_VOICE: RondoVoiceSnapshot = {
  cameraOn: false,
  deafened: false,
  error: null,
  muted: false,
  participants: [],
  phase: 'idle',
  screenAudio: false,
  screenOn: false,
};

export class RondoVoiceSession {
  #snapshot: RondoVoiceSnapshot = EMPTY_RONDO_VOICE;
  readonly #listeners = new Set<Listener>();
  readonly #peers = new Map<string, Peer>();
  readonly #speaking = new Map<string, boolean>();
  readonly #analysers = new Map<string, {
    analyser: AnalyserNode;
    data: Uint8Array<ArrayBuffer>;
    source: MediaStreamAudioSourceNode;
  }>();
  #audioContext: AudioContext | null = null;
  #activityTimer: ReturnType<typeof setTimeout> | null = null;
  #cameraPendingRevision: number | null = null;
  #cameraStream: MediaStream | null = null;
  #cameraRevision = 0;
  #cursor = 0;
  #generation = 0;
  #iceServers: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
  #iceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  #localStream: MediaStream | null = null;
  #media: MediaPreferences;
  #microphoneGain: GainNode | null = null;
  #microphoneInputStream: MediaStream | null = null;
  #microphoneRevision = 0;
  #peerId: string | null = null;
  #pollTimer: ReturnType<typeof setTimeout> | null = null;
  #previewTimer: ReturnType<typeof setTimeout> | null = null;
  #previewRoomId: string | null = null;
  #previewSpaceId: string | null = null;
  #roomId: string | null = null;
  #screenPendingRevision: number | null = null;
  #screenStream: MediaStream | null = null;
  #screenRevision = 0;
  #spaceId: string | null = null;
  #username = '';

  constructor(
    private readonly gateway: RondoVoiceGateway,
    preferences: MediaPreferences = DEFAULT_MEDIA_PREFERENCES,
  ) {
    this.#media = normalizeMediaPreferences(preferences);
  }

  get snapshot(): Readonly<RondoVoiceSnapshot> { return this.#snapshot; }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => { this.#listeners.delete(listener); };
  }

  async configure(preferences: MediaPreferences): Promise<void> {
    const previousMicrophoneId = this.#media.microphoneId;
    this.#media = normalizeMediaPreferences(preferences);
    this.applyMicrophoneGain();
    if (
      previousMicrophoneId !== this.#media.microphoneId
      && this.#snapshot.phase === 'connected'
    ) {
      await this.replaceMicrophone(++this.#microphoneRevision);
    }
  }

  async preview(spaceId: string, roomId: string): Promise<void> {
    if (this.#snapshot.phase !== 'idle' && this.#snapshot.phase !== 'error') return;
    this.#previewSpaceId = spaceId;
    this.#previewRoomId = roomId;
    if (this.#previewTimer) clearTimeout(this.#previewTimer);
    this.#previewTimer = null;
    try {
      const preview = await this.gateway.peek(spaceId, roomId);
      if (this.#spaceId || this.#roomId || this.#previewSpaceId !== spaceId || this.#previewRoomId !== roomId) return;
      this.publish({
        ...EMPTY_RONDO_VOICE,
        participants: preview.participants.map((participant) => ({
          connection: 'new',
          local: false,
          peerId: participant.peerId,
          speaking: false,
          streams: [],
          username: participant.username,
        })),
      });
    } catch {
      // Preview is best effort and must never block the text room.
    }
    if (!this.#spaceId && this.#previewSpaceId === spaceId && this.#previewRoomId === roomId) {
      this.#previewTimer = setTimeout(() => {
        this.#previewTimer = null;
        void this.preview(spaceId, roomId);
      }, PREVIEW_MILLISECONDS);
    }
  }

  async join(spaceId: string, roomId: string): Promise<boolean> {
    if (this.#snapshot.phase === 'joining' || this.#snapshot.phase === 'connected') return false;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      this.publish({ ...EMPTY_RONDO_VOICE, error: 'This device does not provide WebRTC media access.', phase: 'error' });
      return false;
    }
    const generation = ++this.#generation;
    this.stopPreview();
    this.#spaceId = spaceId;
    this.#roomId = roomId;
    this.#peerId = crypto.randomUUID();
    this.publish({ ...EMPTY_RONDO_VOICE, phase: 'joining' });
    try {
      const iceServers = await this.gateway.iceServers().catch(() => this.#iceServers);
      if (generation !== this.#generation) return false;
      this.#iceServers = iceServers;
      const microphone = await this.captureMicrophone();
      if (generation !== this.#generation) {
        stopStream(microphone.output);
        if (microphone.input !== microphone.output) stopStream(microphone.input);
        microphone.gain?.disconnect();
        return false;
      }
      this.#localStream = microphone.output;
      this.#microphoneInputStream = microphone.input;
      this.#microphoneGain = microphone.gain;
      this.watchActivity(this.#peerId, this.#localStream);
      const joined = await this.gateway.join(spaceId, roomId, this.#peerId);
      if (generation !== this.#generation) return false;
      this.#cursor = joined.cursor;
      this.#username = joined.participants.find(({ peerId }) => peerId === this.#peerId)?.username ?? 'You';
      this.publish({ ...this.#snapshot, error: null, phase: 'connected' });
      await this.reconcile(joined, generation);
      this.schedulePoll(generation, 150);
      this.scheduleActivity();
      this.scheduleIceRefresh(generation);
      return true;
    } catch (error) {
      if (generation !== this.#generation) return false;
      await this.leave(false);
      this.publish({ ...EMPTY_RONDO_VOICE, error: mediaError(error), phase: 'error' });
      return false;
    }
  }

  async leave(notify = true): Promise<void> {
    const spaceId = this.#spaceId;
    const roomId = this.#roomId;
    const peerId = this.#peerId;
    const audioContext = this.#audioContext;
    this.#spaceId = null;
    this.#roomId = null;
    this.#peerId = null;
    this.#audioContext = null;
    this.#generation += 1;
    this.#cameraRevision += 1;
    this.#cameraPendingRevision = null;
    this.#screenRevision += 1;
    this.#screenPendingRevision = null;
    this.#microphoneRevision += 1;
    this.stopTimers();
    this.stopPreview();
    this.#peers.forEach(({ connection }) => connection.close());
    this.#peers.clear();
    stopStream(this.#localStream);
    stopStream(this.#microphoneInputStream);
    stopStream(this.#cameraStream);
    stopStream(this.#screenStream);
    this.#microphoneGain?.disconnect();
    this.#localStream = null;
    this.#microphoneInputStream = null;
    this.#microphoneGain = null;
    this.#cameraStream = null;
    this.#screenStream = null;
    for (const peerId of [...this.#analysers.keys()]) this.removeAnalyser(peerId);
    this.#speaking.clear();
    this.#cursor = 0;
    this.#username = '';
    this.publish(EMPTY_RONDO_VOICE);
    await audioContext?.close().catch(() => undefined);
    if (notify && spaceId && roomId && peerId) {
      await this.gateway.leave(spaceId, roomId, peerId);
    }
  }

  toggleMute(): void {
    if (!this.#localStream) return;
    const muted = !this.#snapshot.muted;
    this.#localStream.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    this.publish({ ...this.#snapshot, muted });
  }

  toggleDeafen(): void {
    if (this.#snapshot.phase !== 'connected') return;
    this.publish({ ...this.#snapshot, deafened: !this.#snapshot.deafened });
  }

  async toggleCamera(): Promise<void> {
    if (this.#snapshot.phase !== 'connected') return;
    const revision = ++this.#cameraRevision;
    if (this.#cameraPendingRevision !== null) return;
    if (this.#cameraStream) {
      this.removeStream(this.#cameraStream);
      stopStream(this.#cameraStream);
      this.#cameraStream = null;
      this.publish({ ...this.#snapshot, cameraOn: false, error: null });
      return;
    }
    const generation = this.#generation;
    this.#cameraPendingRevision = revision;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { frameRate: { ideal: 30, max: 60 }, height: { ideal: 720 }, width: { ideal: 1280 } },
      });
      if (
        generation !== this.#generation
        || revision !== this.#cameraRevision
        || this.#snapshot.phase !== 'connected'
      ) {
        stopStream(stream);
        return;
      }
      this.#cameraStream = stream;
      this.addStream(stream);
      this.publish({ ...this.#snapshot, cameraOn: true, error: null });
    } catch (error) {
      if (generation === this.#generation && revision === this.#cameraRevision) {
        this.publish({ ...this.#snapshot, error: mediaError(error) });
      }
    } finally {
      if (this.#cameraPendingRevision === revision) this.#cameraPendingRevision = null;
    }
  }

  async toggleScreen(): Promise<void> {
    if (this.#snapshot.phase !== 'connected') return;
    const revision = ++this.#screenRevision;
    if (this.#screenPendingRevision !== null) return;
    if (this.#screenStream) {
      this.stopScreen();
      return;
    }
    const generation = this.#generation;
    this.#screenPendingRevision = revision;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { frameRate: { ideal: 30, max: 60 } },
      });
      if (
        generation !== this.#generation
        || revision !== this.#screenRevision
        || this.#snapshot.phase !== 'connected'
      ) {
        stopStream(stream);
        return;
      }
      this.#screenStream = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopScreen(stream), { once: true });
      this.addStream(stream);
      this.publish({
        ...this.#snapshot,
        error: null,
        screenAudio: stream.getAudioTracks().length > 0,
        screenOn: true,
      });
    } catch (error) {
      if (generation === this.#generation && revision === this.#screenRevision) {
        this.publish({ ...this.#snapshot, error: mediaError(error) });
      }
    } finally {
      if (this.#screenPendingRevision === revision) this.#screenPendingRevision = null;
    }
  }

  private async captureMicrophone(): Promise<MicrophoneCapture> {
    const { stream: input } = await openMicrophone(this.#media.microphoneId);
    if (typeof AudioContext === 'undefined') return { gain: null, input, output: input };
    try {
      this.#audioContext ??= new AudioContext();
      await this.#audioContext.resume().catch(() => undefined);
      const source = this.#audioContext.createMediaStreamSource(input);
      const gain = this.#audioContext.createGain();
      const destination = this.#audioContext.createMediaStreamDestination();
      gain.gain.value = this.#media.microphoneVolume / 100;
      source.connect(gain).connect(destination);
      const track = destination.stream.getAudioTracks()[0];
      if (!track) return { gain: null, input, output: input };
      return { gain, input, output: new MediaStream([track]) };
    } catch {
      return { gain: null, input, output: input };
    }
  }

  private applyMicrophoneGain(): void {
    if (!this.#microphoneGain) return;
    const at = this.#audioContext?.currentTime ?? 0;
    this.#microphoneGain.gain.setTargetAtTime(this.#media.microphoneVolume / 100, at, 0.015);
  }

  private async replaceMicrophone(revision: number): Promise<void> {
    const generation = this.#generation;
    const previousOutput = this.#localStream;
    const previousInput = this.#microphoneInputStream;
    const previousGain = this.#microphoneGain;
    const previousTrack = previousOutput?.getAudioTracks()[0];
    let microphone: MicrophoneCapture | null = null;
    try {
      microphone = await this.captureMicrophone();
      if (
        generation !== this.#generation
        || revision !== this.#microphoneRevision
        || this.#snapshot.phase !== 'connected'
      ) {
        stopStream(microphone.output);
        if (microphone.input !== microphone.output) stopStream(microphone.input);
        return;
      }
      const nextTrack = microphone.output.getAudioTracks()[0];
      if (!nextTrack) throw new Error('The selected microphone has no audio track.');
      nextTrack.enabled = !this.#snapshot.muted;
      if (previousTrack) {
        await Promise.all([...this.#peers.values()].flatMap(({ connection }) =>
          connection.getSenders()
            .filter(({ track }) => track === previousTrack)
            .map((sender) => sender.replaceTrack(nextTrack))));
      }
      this.#localStream = microphone.output;
      this.#microphoneInputStream = microphone.input;
      this.#microphoneGain = microphone.gain;
      if (this.#peerId) {
        this.removeAnalyser(this.#peerId);
        this.watchActivity(this.#peerId, microphone.output);
      }
      microphone = null;
      stopStream(previousOutput);
      if (previousInput !== previousOutput) stopStream(previousInput);
      previousGain?.disconnect();
      this.publish({ ...this.#snapshot, error: null });
    } catch (error) {
      if (microphone) {
        stopStream(microphone.output);
        if (microphone.input !== microphone.output) stopStream(microphone.input);
      }
      if (generation === this.#generation && revision === this.#microphoneRevision) {
        this.publish({ ...this.#snapshot, error: mediaError(error) });
      }
    }
  }

  private stopScreen(expected?: MediaStream): void {
    if (!this.#screenStream || (expected && this.#screenStream !== expected)) return;
    const stream = this.#screenStream;
    this.#screenStream = null;
    this.removeStream(stream);
    stopStream(stream);
    this.publish({ ...this.#snapshot, screenAudio: false, screenOn: false });
  }

  private addStream(stream: MediaStream): void {
    for (const peer of this.#peers.values()) {
      stream.getTracks().forEach((track) => peer.connection.addTrack(track, stream));
    }
    this.publishParticipants();
  }

  private removeStream(stream: MediaStream): void {
    const tracks = new Set(stream.getTracks());
    for (const peer of this.#peers.values()) {
      peer.connection.getSenders().forEach((sender) => {
        if (sender.track && tracks.has(sender.track)) peer.connection.removeTrack(sender);
      });
    }
    this.publishParticipants();
  }

  private async poll(generation: number): Promise<void> {
    if (generation !== this.#generation || !this.#spaceId || !this.#roomId || !this.#peerId) return;
    try {
      const sync = await this.gateway.sync(this.#spaceId, this.#roomId, this.#peerId, this.#cursor);
      if (generation !== this.#generation) return;
      this.#cursor = sync.cursor;
      await this.reconcile(sync, generation);
      this.schedulePoll(generation, POLL_MILLISECONDS);
    } catch {
      if (generation !== this.#generation) return;
      try {
        const joined = await this.gateway.join(this.#spaceId, this.#roomId, this.#peerId);
        if (generation !== this.#generation) return;
        this.#cursor = joined.cursor;
        await this.reconcile(joined, generation);
        this.schedulePoll(generation, POLL_MILLISECONDS);
      } catch (error) {
        if (generation !== this.#generation) return;
        this.publish({ ...this.#snapshot, error: `Voice signaling is reconnecting. ${readableError(error)}` });
        this.schedulePoll(generation, 2_000);
      }
    }
  }

  private async reconcile(sync: RondoVoiceSync, generation: number): Promise<void> {
    if (generation !== this.#generation || !this.#peerId) return;
    const remoteIds = new Set(sync.participants.map(({ peerId }) => peerId).filter((id) => id !== this.#peerId));
    for (const [peerId, peer] of this.#peers) {
      if (!remoteIds.has(peerId)) {
        peer.connection.close();
        this.#peers.delete(peerId);
        this.removeAnalyser(peerId);
        this.#speaking.delete(peerId);
      }
    }
    for (const participant of sync.participants) {
      if (participant.peerId !== this.#peerId) this.ensurePeer(participant);
    }
    for (const signal of sync.signals) {
      await this.handleSignal(signal, generation);
      if (generation !== this.#generation) return;
    }
    this.publish({ ...this.#snapshot, error: null });
    this.publishParticipants();
  }

  private ensurePeer(participant: RondoVoiceParticipant): Peer {
    const existing = this.#peers.get(participant.peerId);
    if (existing) {
      existing.participant = participant;
      return existing;
    }
    const connection = new RTCPeerConnection({
      iceCandidatePoolSize: 4,
      iceServers: this.#iceServers,
    });
    const peer: Peer = {
      connection,
      generation: this.#generation,
      ignoreOffer: false,
      makingOffer: false,
      participant,
      pendingCandidates: [],
      polite: Boolean(this.#peerId && this.#peerId > participant.peerId),
      streams: new Map(),
    };
    this.#peers.set(participant.peerId, peer);
    for (const stream of this.localStreams()) {
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
    }
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) void this.sendSignal(participant.peerId, 'ice', candidate.toJSON(), peer.generation);
    };
    connection.onnegotiationneeded = () => { void this.negotiate(peer); };
    connection.ontrack = ({ streams }) => {
      if (peer.generation !== this.#generation) return;
      for (const stream of streams) {
        peer.streams.set(stream.id, stream);
        this.watchActivity(participant.peerId, stream);
        stream.addEventListener('removetrack', () => {
          if (peer.generation !== this.#generation) return;
          if (stream.getTracks().length === 0) peer.streams.delete(stream.id);
          this.publishParticipants();
        });
      }
      this.publishParticipants();
    };
    connection.onconnectionstatechange = () => {
      if (peer.generation !== this.#generation) return;
      this.publishParticipants();
      if (connection.connectionState === 'failed') connection.restartIce();
    };
    this.publishParticipants();
    return peer;
  }

  private async negotiate(peer: Peer): Promise<void> {
    try {
      peer.makingOffer = true;
      await peer.connection.setLocalDescription();
      if (peer.generation !== this.#generation) return;
      if (peer.connection.localDescription) {
        await this.sendSignal(
          peer.participant.peerId,
          'offer',
          peer.connection.localDescription,
          peer.generation,
        );
      }
    } catch (error) {
      if (peer.generation === this.#generation) {
        this.publish({ ...this.#snapshot, error: readableError(error) });
      }
    } finally {
      peer.makingOffer = false;
    }
  }

  private async handleSignal(signal: RondoVoiceSignal, generation: number): Promise<void> {
    if (generation !== this.#generation) return;
    const participant = this.#peers.get(signal.fromPeerId)?.participant;
    if (!participant) return;
    const peer = this.ensurePeer(participant);
    try {
      if (signal.type === 'ice') {
        const candidate = JSON.parse(signal.payload) as RTCIceCandidateInit;
        if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(candidate);
        else peer.pendingCandidates.push(candidate);
        return;
      }
      const description = JSON.parse(signal.payload) as RTCSessionDescriptionInit;
      const collision = description.type === 'offer' &&
        (peer.makingOffer || peer.connection.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await peer.connection.setRemoteDescription(description);
      while (peer.pendingCandidates.length) {
        await peer.connection.addIceCandidate(peer.pendingCandidates.shift()!);
      }
      if (description.type === 'offer') {
        await peer.connection.setLocalDescription();
        if (peer.connection.localDescription) {
          await this.sendSignal(
            signal.fromPeerId,
            'answer',
            peer.connection.localDescription,
            generation,
          );
        }
      }
    } catch (error) {
      if (!peer.ignoreOffer && generation === this.#generation) {
        this.publish({ ...this.#snapshot, error: readableError(error) });
      }
    }
  }

  private async sendSignal(
    toPeerId: string,
    type: RondoVoiceSignal['type'],
    payload: RTCIceCandidateInit | RTCSessionDescriptionInit,
    generation: number,
  ): Promise<void> {
    if (generation !== this.#generation || !this.#spaceId || !this.#roomId || !this.#peerId) return;
    await this.gateway.signal(this.#spaceId, this.#roomId, {
      payload: JSON.stringify(payload),
      peerId: this.#peerId,
      toPeerId,
      type,
    });
  }

  private localStreams(): MediaStream[] {
    return [this.#localStream, this.#cameraStream, this.#screenStream]
      .filter((stream): stream is MediaStream => stream !== null);
  }

  private publishParticipants(): void {
    if (!this.#peerId || this.#snapshot.phase === 'idle') return;
    const localStreams = [this.#cameraStream, this.#screenStream]
      .filter((stream): stream is MediaStream => stream !== null);
    const participants: RondoVoicePeer[] = [{
      connection: 'local',
      local: true,
      peerId: this.#peerId,
      speaking: this.#speaking.get(this.#peerId) ?? false,
      streams: localStreams,
      username: this.#username || 'You',
    }, ...[...this.#peers.values()].map((peer) => ({
      connection: peer.connection.connectionState,
      local: false,
      peerId: peer.participant.peerId,
      speaking: this.#speaking.get(peer.participant.peerId) ?? false,
      streams: [...peer.streams.values()],
      username: peer.participant.username,
    }))];
    this.publish({ ...this.#snapshot, participants });
  }

  private watchActivity(peerId: string, stream: MediaStream): void {
    if (!stream.getAudioTracks().length || this.#analysers.has(peerId)) return;
    try {
      this.#audioContext ??= new AudioContext();
      const analyser = this.#audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = this.#audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      this.#analysers.set(peerId, {
        analyser,
        data: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
        source,
      });
    } catch {
      // Speaking indicators are optional; audio transport keeps working.
    }
  }

  private removeAnalyser(peerId: string): void {
    const entry = this.#analysers.get(peerId);
    if (!entry) return;
    entry.source.disconnect();
    entry.analyser.disconnect();
    this.#analysers.delete(peerId);
  }

  private scheduleActivity(): void {
    if (this.#activityTimer || this.#snapshot.phase !== 'connected') return;
    this.#activityTimer = setTimeout(() => {
      this.#activityTimer = null;
      let changed = false;
      for (const [peerId, { analyser, data }] of this.#analysers) {
        analyser.getByteTimeDomainData(data);
        let energy = 0;
        for (const value of data) energy += ((value - 128) / 128) ** 2;
        const speaking = Math.sqrt(energy / data.length) > 0.035;
        if (this.#speaking.get(peerId) !== speaking) {
          this.#speaking.set(peerId, speaking);
          changed = true;
        }
      }
      if (changed) this.publishParticipants();
      this.scheduleActivity();
    }, 140);
  }

  private schedulePoll(generation: number, delay: number): void {
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    this.#pollTimer = setTimeout(() => {
      this.#pollTimer = null;
      void this.poll(generation);
    }, delay);
  }

  private scheduleIceRefresh(generation: number): void {
    if (this.#iceRefreshTimer) clearTimeout(this.#iceRefreshTimer);
    this.#iceRefreshTimer = setTimeout(() => {
      this.#iceRefreshTimer = null;
      void this.refreshIce(generation);
    }, ICE_REFRESH_MILLISECONDS);
  }

  private async refreshIce(generation: number): Promise<void> {
    if (generation !== this.#generation || this.#snapshot.phase !== 'connected') return;
    try {
      this.#iceServers = await this.gateway.iceServers();
      for (const { connection } of this.#peers.values()) {
        connection.setConfiguration({
          ...connection.getConfiguration(),
          iceServers: this.#iceServers,
        });
      }
    } catch {
      // Existing peer connections remain valid; retry without interrupting the call.
    }
    this.scheduleIceRefresh(generation);
  }

  private stopTimers(): void {
    if (this.#pollTimer) clearTimeout(this.#pollTimer);
    if (this.#activityTimer) clearTimeout(this.#activityTimer);
    if (this.#iceRefreshTimer) clearTimeout(this.#iceRefreshTimer);
    this.#pollTimer = null;
    this.#activityTimer = null;
    this.#iceRefreshTimer = null;
  }

  private stopPreview(): void {
    if (this.#previewTimer) clearTimeout(this.#previewTimer);
    this.#previewTimer = null;
    this.#previewSpaceId = null;
    this.#previewRoomId = null;
  }

  private publish(snapshot: RondoVoiceSnapshot): void {
    this.#snapshot = snapshot;
    this.#listeners.forEach((listener) => listener(snapshot));
  }
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Voice connection failed.';
}

function mediaError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone, camera or screen access was not allowed.';
  }
  return readableError(error);
}

const POLL_MILLISECONDS = 800;
const PREVIEW_MILLISECONDS = 5_000;
const ICE_REFRESH_MILLISECONDS = 12 * 60 * 60 * 1_000;
