// Stores validated Rondo device and volume defaults for this browser

export interface VoicePreferences {
	microphoneId: string;
	speakerId: string;
	cameraId: string;
	microphoneVolume: number;
	speakerVolume: number;
}

export type VoiceVolumeKey = 'microphoneVolume' | 'speakerVolume';

export const devicePreferenceKeys = {
	audioinput: 'microphoneId',
	audiooutput: 'speakerId',
	videoinput: 'cameraId'
} as const;

const storageKey = 'kaordo-rondo-voice';

export function clampVoiceVolume(percent: number): number {
	return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 100;
}

export function defaultVoicePreferences(): VoicePreferences {
	return {
		microphoneId: 'default',
		speakerId: 'default',
		cameraId: 'default',
		microphoneVolume: 100,
		speakerVolume: 100
	};
}

export function loadVoicePreferences(): VoicePreferences {
	const defaults = defaultVoicePreferences();
	try {
		const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
		if (typeof value !== 'object' || value === null) return defaults;
		const saved = value as Record<string, unknown>;
		for (const key of Object.values(devicePreferenceKeys)) {
			if (typeof saved[key] === 'string' && saved[key].length > 0) defaults[key] = saved[key];
		}
		for (const key of ['microphoneVolume', 'speakerVolume'] as const) {
			if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) {
				defaults[key] = Math.round(clampVoiceVolume(saved[key]));
			}
		}
	} catch {
		// Browser storage may be unavailable or contain an obsolete value
	}
	return defaults;
}

export function saveVoicePreferences(preferences: VoicePreferences): void {
	localStorage.setItem(storageKey, JSON.stringify(preferences));
}

export function sameVoicePreferences(a: VoicePreferences, b: VoicePreferences): boolean {
	return (
		a.microphoneId === b.microphoneId &&
		a.speakerId === b.speakerId &&
		a.cameraId === b.cameraId &&
		a.microphoneVolume === b.microphoneVolume &&
		a.speakerVolume === b.speakerVolume
	);
}
