// Discovers local devices and owns a cancellable microphone level check

import { createLocalAudioTrack, Room, supportsAudioOutputSelection, type LocalAudioTrack } from 'livekit-client';
import { clampVoiceVolume } from './preferences.js';

export { supportsAudioOutputSelection };

export function listVoiceDevices(kind?: MediaDeviceKind, requestPermissions = false): Promise<MediaDeviceInfo[]> {
  return Room.getLocalDevices(kind, requestPermissions);
}

export async function chooseSpeaker(): Promise<MediaDeviceInfo | null> {
  const devices = navigator.mediaDevices;
  if ('selectAudioOutput' in devices && typeof devices.selectAudioOutput === 'function') {
    return devices.selectAudioOutput();
  }
  await listVoiceDevices('audiooutput', true);
  return null;
}

export function voiceDeviceError(cause: unknown): string {
  if (cause instanceof DOMException) {
    if (cause.name === 'NotAllowedError') return 'Access was denied. Allow this device in your browser settings and try again.';
    if (cause.name === 'NotFoundError' || cause.name === 'OverconstrainedError') return 'This device is unavailable. Connect it or choose another device.';
    if (cause.name === 'NotReadableError') return 'This device could not be opened. Check whether another application is using it.';
  }
  return cause instanceof Error ? cause.message : 'Could not access this device.';
}

export class MicrophoneCheck {
  private revision = 0;
  private track: LocalAudioTrack | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frame = 0;
  private volume = 1;

  async start(deviceId: string, volume: number, onLevel: (percent: number) => void): Promise<boolean> {
    this.stop();
    this.setVolume(volume);
    const revision = this.revision;
    const context = new AudioContext();
    this.context = context;
    try {
      await context.resume();
      if (revision !== this.revision) return false;
      const track = await createLocalAudioTrack({
        deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
        echoCancellation: true, noiseSuppression: true, autoGainControl: false
      });
      if (revision !== this.revision) { track.stop(); return false; }
      this.track = track;
      this.source = context.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      this.source.connect(this.analyser);
      // Keep the analyser running without playing microphone audio through the speakers
      const silent = context.createGain();
      silent.gain.value = 0;
      this.analyser.connect(silent).connect(context.destination);
      const samples = new Float32Array(this.analyser.fftSize);
      const sample = () => {
        if (revision !== this.revision || !this.analyser) return;
        this.analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        onLevel(Math.min(100, Math.round(rms * this.volume * 400)));
        this.frame = requestAnimationFrame(sample);
      };
      sample();
      return true;
    } catch (cause) {
      if (revision !== this.revision) return false;
      this.stop();
      throw cause;
    }
  }

  setVolume(percent: number): void {
    this.volume = clampVoiceVolume(percent) / 100;
  }

  stop(): void {
    this.revision++;
    cancelAnimationFrame(this.frame);
    this.track?.stop();
    this.source?.disconnect();
    this.analyser?.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.track = null;
    this.context = null;
    this.source = null;
    this.analyser = null;
  }
}
