// Defines voice presentation snapshots without loading LiveKit
export type ScreenQuality =
	'360p15' | '720p5' | '720p15' | '720p30' | '1080p15' | '1080p30' | 'original';
export type VideoSource = 'camera' | 'screen';

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

export const emptyVoiceSnapshot = (): VoiceSnapshot => ({
	connected: false,
	reconnecting: false,
	microphoneEnabled: false,
	cameraEnabled: false,
	screenShareEnabled: false,
	deafened: false,
	canPlaybackAudio: true,
	canPlaybackVideo: true,
	participants: [],
	videos: []
});
