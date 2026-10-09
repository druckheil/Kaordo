// Applies microphone volume through LiveKit's audio processor lifecycle

import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { clampVoiceVolume } from './preferences.js';

export class MicrophoneVolume implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
	readonly name = 'kaordo-microphone-volume';
	processedTrack?: MediaStreamTrack;
	private source?: MediaStreamAudioSourceNode;
	private gain?: GainNode;
	private volume = 1;

	setVolume(percent: number): void {
		this.volume = clampVoiceVolume(percent) / 100;
		if (this.gain) this.gain.gain.setTargetAtTime(this.volume, this.gain.context.currentTime, 0.02);
	}

	init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
		this.source = audioContext.createMediaStreamSource(new MediaStream([track]));
		this.gain = audioContext.createGain();
		this.gain.gain.value = this.volume;
		const destination = audioContext.createMediaStreamDestination();
		this.source.connect(this.gain).connect(destination);
		this.processedTrack = destination.stream.getAudioTracks()[0];
		return Promise.resolve();
	}

	async restart(options: AudioProcessorOptions): Promise<void> {
		await this.destroy();
		await this.init(options);
	}

	destroy(): Promise<void> {
		this.source?.disconnect();
		this.gain?.disconnect();
		this.processedTrack?.stop();
		this.source = undefined;
		this.gain = undefined;
		this.processedTrack = undefined;
		return Promise.resolve();
	}
}
