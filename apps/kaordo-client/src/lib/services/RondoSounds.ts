/**
 * Tiny, generated UI sounds for Rondo actions.
 *
 * Keeping these tones in Web Audio avoids shipping another media asset and
 * lets the browser/Tauri runtime release the context shortly after a sound.
 * Every call is best effort: a blocked audio context must never interrupt a
 * voice action.
 */
export type RondoSound =
  | 'camera-off'
  | 'camera-on'
  | 'deafen'
  | 'join'
  | 'leave'
  | 'mute'
  | 'screen-off'
  | 'screen-on'
  | 'undeafen'
  | 'unmute';

type Tone = { duration: number; end: number; start: number; type: OscillatorType };

const TONES: Record<RondoSound, Tone[]> = {
  join: [{ duration: 0.16, end: 660, start: 440, type: 'sine' }, { duration: 0.18, end: 880, start: 660, type: 'sine' }],
  leave: [{ duration: 0.18, end: 440, start: 660, type: 'sine' }, { duration: 0.2, end: 330, start: 440, type: 'sine' }],
  mute: [{ duration: 0.1, end: 310, start: 390, type: 'triangle' }],
  unmute: [{ duration: 0.1, end: 520, start: 390, type: 'triangle' }],
  deafen: [{ duration: 0.1, end: 260, start: 340, type: 'square' }],
  undeafen: [{ duration: 0.1, end: 500, start: 340, type: 'square' }],
  'camera-on': [{ duration: 0.12, end: 720, start: 520, type: 'sine' }],
  'camera-off': [{ duration: 0.12, end: 360, start: 520, type: 'sine' }],
  'screen-on': [{ duration: 0.12, end: 780, start: 560, type: 'sine' }],
  'screen-off': [{ duration: 0.12, end: 390, start: 560, type: 'sine' }],
};

let audioContext: AudioContext | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

export function playRondoSound(sound: RondoSound): void {
  if (typeof window === 'undefined') return;
  const Context = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;

  try {
    audioContext ??= new Context();
    const context = audioContext;
    if (closeTimer) clearTimeout(closeTimer);
    void context.resume().catch(() => undefined);
    let offset = context.currentTime;
    for (const tone of TONES[sound]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.start, offset);
      oscillator.frequency.exponentialRampToValueAtTime(tone.end, offset + tone.duration);
      gain.gain.setValueAtTime(0.0001, offset);
      gain.gain.exponentialRampToValueAtTime(0.045, offset + Math.min(0.02, tone.duration / 4));
      gain.gain.exponentialRampToValueAtTime(0.0001, offset + tone.duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(offset);
      oscillator.stop(offset + tone.duration + 0.01);
      offset += tone.duration * 0.72;
    }
    closeTimer = setTimeout(() => {
      closeTimer = null;
      const current = audioContext;
      audioContext = null;
      void current?.close().catch(() => undefined);
    }, 2_000);
  } catch {
    // Sound is decorative. Never turn an otherwise successful action into an error.
  }
}
