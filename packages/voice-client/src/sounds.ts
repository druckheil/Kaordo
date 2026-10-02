export type VoiceCue = 'connect' | 'disconnect' | 'mute' | 'unmute' | 'deafen' | 'undeafen' |
  'cameraOn' | 'cameraOff' | 'screenOn' | 'screenOff';

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

export class VoiceSounds {
  private context: AudioContext | null = null;
  enabled = true;

  unlock(): void {
    if (!this.enabled || typeof AudioContext === 'undefined') return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Voice remains available when interface audio cannot start. */ }
  }

  play(cue: VoiceCue): void {
    if (!this.enabled) return;
    this.unlock();
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const start = context.currentTime;
    for (const [frequency, offset] of notes[cue]) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0.0001, start + offset);
      envelope.gain.exponentialRampToValueAtTime(0.022, start + offset + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.12);
      oscillator.connect(envelope).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.13);
    }
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    if (context) void context.close().catch(() => {});
  }
}
