import { ConnectionState, Room, RoomEvent, ScreenSharePresets, Track, VideoPresets,
  type Participant, type RemoteTrack } from 'livekit-client';
import { VoiceSounds } from './sounds.js';

export type ScreenQuality = '360p15' | '720p5' | '720p15' | '720p30' | '1080p15' | '1080p30' | 'original';
export type VideoSource = 'camera' | 'screen';

const screenPresets = {
  '360p15': ScreenSharePresets.h360fps15,
  '720p5': ScreenSharePresets.h720fps5,
  '720p15': ScreenSharePresets.h720fps15,
  '720p30': ScreenSharePresets.h720fps30,
  '1080p15': ScreenSharePresets.h1080fps15,
  '1080p30': ScreenSharePresets.h1080fps30,
  original: ScreenSharePresets.original
} as const;

export interface VoiceParticipant {
  id: string;
  name: string;
  speaking: boolean;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  local: boolean;
}

export interface VoiceVideo {
  id: string;
  participantId: string;
  name: string;
  source: VideoSource;
  local: boolean;
  trackSid: string;
}

export interface VoiceSnapshot {
  connected: boolean;
  reconnecting: boolean;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  deafened: boolean;
  canPlaybackAudio: boolean;
  canPlaybackVideo: boolean;
  participants: VoiceParticipant[];
  videos: VoiceVideo[];
}

type LocalControls = Pick<VoiceSnapshot, 'microphoneEnabled' | 'cameraEnabled' | 'screenShareEnabled'>;

export const emptyVoiceSnapshot = (): VoiceSnapshot => ({
  connected: false, reconnecting: false, microphoneEnabled: false, cameraEnabled: false, screenShareEnabled: false,
  deafened: false, canPlaybackAudio: true, canPlaybackVideo: true, participants: [], videos: []
});

export class VoiceConnection {
  private readonly room = new Room({ adaptiveStream: true, dynacast: true });
  private readonly audioElements = new Set<HTMLMediaElement>();
  private readonly sounds: VoiceSounds;
  private listener: ((state: VoiceSnapshot) => void) | undefined;
  private connected = false;
  private initializing = true;
  private suppressControlCues = false;
  private lastControls: LocalControls | null = null;
  private deafened = false;
  private microphoneBeforeDeafen = false;

  constructor(sounds = new VoiceSounds()) {
    this.sounds = sounds;
    const update = () => this.emit();
    for (const event of [
      RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.AudioPlaybackStatusChanged,
      RoomEvent.VideoPlaybackStatusChanged, RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished, RoomEvent.ConnectionStateChanged,
      RoomEvent.ParticipantNameChanged
    ]) this.room.on(event, update);
    this.room.on(RoomEvent.ParticipantConnected, () => {
      if (this.room.state === 'connected' && this.connected) this.sounds.play('connect');
      this.emit();
    });
    this.room.on(RoomEvent.ParticipantDisconnected, () => {
      if (this.room.state === 'connected' && this.connected) this.sounds.play('disconnect');
      this.emit();
    });
    this.room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach();
        element.className = 'sr-only';
        element.muted = this.deafened;
        document.body.append(element);
        this.audioElements.add(element);
      }
      this.emit();
    });
    this.room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) this.detachAudio(track);
      this.emit();
    });
  }

  setSoundEnabled(enabled: boolean): void {
    this.sounds.enabled = enabled;
    if (enabled) this.sounds.unlock();
  }

  subscribe(listener: (state: VoiceSnapshot) => void): void {
    this.listener = listener;
    this.emit();
  }

  private controls(): LocalControls {
    const local = this.room.localParticipant;
    return {
      microphoneEnabled: local.isMicrophoneEnabled,
      cameraEnabled: local.isCameraEnabled,
      screenShareEnabled: local.isScreenShareEnabled
    };
  }

  private emit(): void {
    const connected = this.room.state === ConnectionState.Connected;
    const reconnecting = this.room.state === ConnectionState.Reconnecting ||
      this.room.state === ConnectionState.SignalReconnecting;
    const controls = this.controls();
    if (connected && !this.connected) this.sounds.play('connect');
    else if (this.room.state === ConnectionState.Disconnected && this.connected) this.sounds.play('disconnect');
    if (connected && !this.initializing && !this.suppressControlCues && this.lastControls) {
      for (const [key, on, off] of [
        ['microphoneEnabled', 'unmute', 'mute'],
        ['cameraEnabled', 'cameraOn', 'cameraOff'],
        ['screenShareEnabled', 'screenOn', 'screenOff']
      ] as const) {
        if (controls[key] !== this.lastControls[key]) this.sounds.play(controls[key] ? on : off);
      }
    }
    if (connected || this.room.state === ConnectionState.Disconnected) this.connected = connected;
    this.lastControls = connected ? controls : null;
    const participants: VoiceParticipant[] = [];
    const videos: VoiceVideo[] = [];
    if (connected || reconnecting) {
      const addParticipant = (participant: Participant, local: boolean) => {
        participants.push({ id: participant.identity, name: participant.name || participant.identity,
          speaking: participant.isSpeaking, microphoneEnabled: participant.isMicrophoneEnabled,
          cameraEnabled: participant.isCameraEnabled, screenShareEnabled: participant.isScreenShareEnabled, local });
        for (const [source, trackSource] of [
          ['camera', Track.Source.Camera], ['screen', Track.Source.ScreenShare]
        ] as const) {
          const publication = participant.getTrackPublication(trackSource);
          if (!publication?.videoTrack || publication.isMuted) continue;
          videos.push({ id: `${participant.identity}:${source}:${publication.trackSid}`,
            participantId: participant.identity, name: participant.name || participant.identity,
            source, local, trackSid: publication.trackSid });
        }
      };
      addParticipant(this.room.localParticipant, true);
      for (const participant of this.room.remoteParticipants.values()) addParticipant(participant, false);
    }
    this.listener?.({ connected, reconnecting, ...controls, deafened: this.deafened,
      canPlaybackAudio: this.room.canPlaybackAudio, canPlaybackVideo: this.room.canPlaybackVideo,
      participants, videos });
  }

  attachVideo(video: VoiceVideo, element: HTMLVideoElement): () => void {
    const participant = video.local ? this.room.localParticipant : this.room.remoteParticipants.get(video.participantId);
    const source = video.source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;
    const publication = participant?.getTrackPublication(source);
    const track = publication?.trackSid === video.trackSid ? publication.videoTrack : undefined;
    if (!track) return () => {};
    element.autoplay = true;
    element.playsInline = true;
    element.muted = video.local;
    track.attach(element);
    return () => { track.detach(element); };
  }

  async connect(serverUrl: string, token: string): Promise<void> {
    this.sounds.unlock();
    await this.room.connect(serverUrl, token);
    this.emit();
    try { await this.room.localParticipant.setMicrophoneEnabled(true); } catch { /* Listen only. */ }
    this.initializing = false;
    this.lastControls = this.controls();
    this.emit();
  }

  async toggleMicrophone(): Promise<void> {
    if (this.deafened) throw new Error('Undeafen before using the microphone.');
    this.sounds.unlock();
    await this.room.localParticipant.setMicrophoneEnabled(!this.room.localParticipant.isMicrophoneEnabled);
    this.emit();
  }

  async toggleDeafen(): Promise<void> {
    this.sounds.unlock();
    this.suppressControlCues = true;
    const next = !this.deafened;
    try {
      if (next) {
        this.microphoneBeforeDeafen = this.room.localParticipant.isMicrophoneEnabled;
        await this.room.localParticipant.setMicrophoneEnabled(false);
      }
      this.deafened = next;
      for (const element of this.audioElements) element.muted = next;
      if (!next && this.microphoneBeforeDeafen) {
        this.microphoneBeforeDeafen = false;
        await this.room.localParticipant.setMicrophoneEnabled(true);
      }
      this.sounds.play(next ? 'deafen' : 'undeafen');
    } finally {
      this.lastControls = this.controls();
      this.suppressControlCues = false;
      this.emit();
    }
  }

  async toggleCamera(): Promise<void> {
    this.sounds.unlock();
    const enabled = !this.room.localParticipant.isCameraEnabled;
    await this.room.localParticipant.setCameraEnabled(enabled,
      enabled ? { resolution: VideoPresets.h720.resolution } : undefined,
      enabled ? { videoEncoding: VideoPresets.h720.encoding } : undefined);
    this.emit();
  }

  async toggleScreenShare(quality: ScreenQuality = '1080p15', includeAudio = false): Promise<void> {
    this.sounds.unlock();
    const enabled = !this.room.localParticipant.isScreenShareEnabled;
    const preset = screenPresets[quality];
    await this.room.localParticipant.setScreenShareEnabled(enabled,
      enabled ? { resolution: preset.resolution, audio: includeAudio,
        contentHint: quality.endsWith('30') ? 'motion' : 'detail' } : undefined,
      enabled ? { screenShareEncoding: preset.encoding } : undefined);
    this.emit();
  }

  async startAudio(): Promise<void> {
    await this.room.startAudio();
    this.emit();
  }

  async startVideo(): Promise<void> {
    await this.room.startVideo();
    this.emit();
  }

  private detachAudio(track: RemoteTrack): void {
    for (const element of track.detach()) {
      element.remove();
      this.audioElements.delete(element);
    }
  }

  async disconnect(): Promise<void> {
    this.listener = undefined;
    try { await this.room.disconnect(); }
    finally {
      this.emit();
      for (const element of this.audioElements) element.remove();
      this.audioElements.clear();
      setTimeout(() => this.sounds.dispose(), 420);
    }
  }
}
