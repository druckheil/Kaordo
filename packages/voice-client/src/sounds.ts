// Generates short local audio cues for voice and media control changes
import { clampVoiceVolume } from './preferences.js';

export type VoiceCue =
  | 'connect'
  | 'disconnect'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'cameraOn'
  | 'cameraOff'
  | 'screenOn'
  | 'screenOff';

const notes: Record<VoiceCue, readonly [number, number][]> = {
  connect: [[523, 0], [784, 0.09]],
  disconnect: [[659, 0], [392, 0.09]],
  mute: [[440, 0], [330, 0.07]],
  unmute: [[440, 0], [587, 0.07]],
  deafen: [[392, 0], [262, 0.09]],
  undeafen: [[392, 0], [659, 0.09]],
  cameraOn: [[587, 0], [740, 0.08]],
  cameraOff: [[740, 0], [587, 0.08]],
  screenOn: [[523, 0], [659, 0.08], [880, 0.16]],
  screenOff: [[880, 0], [659, 0.08], [440, 0.16]]
};

const cueTone = { gain: 0.022, duration: 0.12 };
const testTone = { gain: 0.12, duration: 0.3 };

function scheduleTone(context: AudioContext, destination: AudioNode, frequency: number, startAt: number, tone = cueTone): void {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0.0001, startAt);
  envelope.gain.exponentialRampToValueAtTime(tone.gain, startAt + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration);
  oscillator.connect(envelope).connect(destination);
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  oscillator.start(startAt);
  oscillator.stop(startAt + tone.duration + 0.02);
}

export class VoiceSounds {
  private context: AudioContext | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private output: HTMLAudioElement | null = null;
  private volume = 100;
  private disposed = false;
  private testTimer?: ReturnType<typeof setTimeout>;
  private disposalTimer?: ReturnType<typeof setTimeout>;
  private finishTest?: () => void;
  enabled = true;

  unlock(): void {
    if (this.disposed || !this.enabled || typeof AudioContext === 'undefined') return;
    try {
      if (!this.context) this.initializeAudio();
      if (this.context?.state === 'suspended') void this.resumeContext(this.context);
      void this.output?.play().catch(() => {});
    } catch { /* Voice remains available when interface audio cannot start. */ }
  }

  private initializeAudio(): void {
    const context = new AudioContext();
    try {
      const destination = context.createMediaStreamDestination();
      const output = new Audio();
      output.srcObject = destination.stream;
      output.volume = this.volume / 100;
      this.context = context;
      this.destination = destination;
      this.output = output;
    } catch (cause) {
      void context.close().catch(() => {});
      throw cause;
    }
  }

  setVolume(percent: number): void {
    this.volume = clampVoiceVolume(percent);
    if (this.output) this.output.volume = this.volume / 100;
  }

  async setOutput(deviceId: string): Promise<void> {
    if (this.disposed) return;
    this.unlock();
    const output = this.output;
    if (output && 'setSinkId' in output) await output.setSinkId(deviceId === 'default' ? '' : deviceId);
  }

  async testOutput(): Promise<void> {
    if (this.disposed) return;
    this.unlock();
    const context = this.context;
    const output = this.output;
    const destination = this.destination;
    if (!context || !output || !destination) throw new Error('Audio playback is unavailable in this browser.');
    await context.resume();
    if (this.disposed) return;
    await output.play();
    if (this.disposed) return;
    if (context.state !== 'running') throw new Error('Audio playback could not start. Try again.');
    const startAt = context.currentTime;
    for (const [index, frequency] of [440, 660, 880].entries()) {
      scheduleTone(context, destination, frequency, startAt + index * 0.4, testTone);
    }
    this.completeTest();
    await new Promise<void>((resolve) => {
      this.finishTest = resolve;
      // Allow the final tone and the media element's playback buffer to drain
      this.testTimer = setTimeout(() => this.completeTest(), 1400);
    });
  }

  private async resumeContext(context: AudioContext): Promise<void> {
    try {
      await context.resume();
    } catch {
      // Audio cues are optional and must not interrupt voice controls.
    }
  }

  play(cue: VoiceCue): void {
    if (this.disposed || !this.enabled) return;
    this.unlock();
    const context = this.context;
    if (!context || !this.destination || context.state !== 'running') return;
    const cueStart = context.currentTime;
    for (const [frequency, offset] of notes[cue]) {
      scheduleTone(context, this.destination, frequency, cueStart + offset);
    }
  }

  dispose(delayMs = 0): void {
    this.disposed = true;
    this.completeTest();
    if (this.disposalTimer) clearTimeout(this.disposalTimer);
    if (delayMs > 0) {
      this.disposalTimer = setTimeout(() => this.releaseAudio(), delayMs);
    } else {
      this.releaseAudio();
    }
  }

  private completeTest(): void {
    if (this.testTimer) clearTimeout(this.testTimer);
    this.testTimer = undefined;
    const finish = this.finishTest;
    this.finishTest = undefined;
    finish?.();
  }

  private releaseAudio(): void {
    this.disposalTimer = undefined;
    const context = this.context;
    this.context = null;
    this.destination?.stream.getTracks().forEach((track) => track.stop());
    this.destination = null;
    this.output?.pause();
    if (this.output) this.output.srcObject = null;
    this.output = null;
    if (context) void context.close().catch(() => {});
  }
}
