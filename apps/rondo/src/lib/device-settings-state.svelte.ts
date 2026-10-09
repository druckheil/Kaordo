// Owns local device discovery, defaults and the lifetime of microphone/speaker checks
import { onMount } from 'svelte';
import {
	chooseSpeaker,
	listVoiceDevices,
	MicrophoneCheck,
	supportsAudioOutputSelection,
	voiceDeviceError
} from '@kaordo/voice-client/devices';
import {
	devicePreferenceKeys,
	loadVoicePreferences,
	sameVoicePreferences,
	saveVoicePreferences,
	type VoicePreferences,
	type VoiceVolumeKey
} from '@kaordo/voice-client/preferences';
import { VoiceSounds } from '@kaordo/voice-client/sounds';

interface DeviceSettingsDependencies {
	preferences: () => VoicePreferences;
	onDeviceChange: (kind: MediaDeviceKind, deviceId: string) => Promise<void>;
	onVolumeChange: (key: VoiceVolumeKey, value: number) => void;
}

export function createDeviceSettingsState({
	preferences,
	onDeviceChange,
	onVolumeChange
}: DeviceSettingsDependencies) {
	const microphone = new MicrophoneCheck();
	let devices = $state<MediaDeviceInfo[]>([]);
	let outputSupported = $state(false);
	let mediaSupported = $state(true);
	let busyKind = $state<MediaDeviceKind | null>(null);
	const errors = $state<Partial<Record<MediaDeviceKind | 'defaults' | 'devices', string>>>({});
	let saved = $state<VoicePreferences>(loadVoicePreferences());
	let microphoneState = $state<'idle' | 'starting' | 'testing'>('idle');
	let microphoneLevel = $state(0);
	let speakerTesting = $state(false);
	let speakerSounds: VoiceSounds | null = null;
	let deviceRevision = 0;
	let active = false;
	const defaultsChanged = $derived(!sameVoicePreferences(preferences(), saved));

	onMount(() => {
		active = true;
		const capabilities: Partial<Pick<Navigator, 'mediaDevices'>> = navigator;
		const mediaDevices = capabilities.mediaDevices;
		mediaSupported = !!mediaDevices;
		outputSupported = supportsAudioOutputSelection();
		if (mediaDevices) {
			void refreshDevices();
			mediaDevices.addEventListener('devicechange', handleDeviceChange);
		}
		return () => {
			active = false;
			deviceRevision++;
			mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
			stopMicrophone();
			stopSpeakers();
		};
	});

	function handleDeviceChange(): void {
		void refreshDevices();
	}

	async function refreshDevices(): Promise<void> {
		const revision = ++deviceRevision;
		try {
			const listed = await listVoiceDevices();
			if (active && revision === deviceRevision) {
				devices = listed;
				errors.devices = '';
			}
		} catch (cause) {
			if (active && revision === deviceRevision) errors.devices = voiceDeviceError(cause);
		}
	}

	async function runDeviceAction(
		kind: MediaDeviceKind,
		action: () => Promise<void>
	): Promise<void> {
		if (!active || busyKind) return;
		busyKind = kind;
		errors[kind] = '';
		if (kind === 'audioinput') stopMicrophone();
		if (kind === 'audiooutput') stopSpeakers();
		try {
			await action();
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The view can unmount while the device action awaits
			if (active) await refreshDevices();
		} catch (cause) {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The view can unmount while the device action awaits
			if (active) errors[kind] = voiceDeviceError(cause);
		} finally {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The view can unmount while the device action awaits
			if (active) busyKind = null;
		}
	}

	function changeDevice(kind: MediaDeviceKind, deviceId: string): Promise<void> | undefined {
		if (preferences()[devicePreferenceKeys[kind]] === deviceId) return;
		return runDeviceAction(kind, () => onDeviceChange(kind, deviceId));
	}

	function allowDevices(kind: MediaDeviceKind): Promise<void> {
		return runDeviceAction(kind, async () => {
			if (kind !== 'audiooutput') {
				await listVoiceDevices(kind, true);
				return;
			}
			const selected = await chooseSpeaker();
			if (active && selected) await onDeviceChange(kind, selected.deviceId);
		});
	}

	function changeVolume(key: VoiceVolumeKey, value: number): void {
		onVolumeChange(key, value);
		if (key === 'microphoneVolume') microphone.setVolume(value);
		else speakerSounds?.setVolume(value);
	}

	function stopMicrophone(): void {
		microphone.stop();
		microphoneState = 'idle';
		microphoneLevel = 0;
	}

	async function toggleMicrophoneCheck(): Promise<void> {
		if (microphoneState !== 'idle') {
			stopMicrophone();
			return;
		}
		microphoneState = 'starting';
		errors.audioinput = '';
		try {
			const started = await microphone.start(
				preferences().microphoneId,
				preferences().microphoneVolume,
				(level) => {
					if (active) microphoneLevel = level;
				}
			);
			if (active && started) {
				microphoneState = 'testing';
				await refreshDevices();
			}
		} catch (cause) {
			if (active) {
				stopMicrophone();
				errors.audioinput = voiceDeviceError(cause);
			}
		}
	}

	function stopSpeakers(): void {
		speakerSounds?.dispose();
		speakerSounds = null;
		speakerTesting = false;
	}

	async function toggleSpeakerCheck(): Promise<void> {
		if (speakerTesting) {
			stopSpeakers();
			return;
		}
		speakerTesting = true;
		errors.audiooutput = '';
		const sounds = new VoiceSounds();
		speakerSounds = sounds;
		sounds.setVolume(preferences().speakerVolume);
		sounds.unlock();
		try {
			await sounds.setOutput(outputSupported ? preferences().speakerId : 'default');
			if (!active || speakerSounds !== sounds) return;
			await sounds.testOutput();
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- The view can unmount while the speaker check awaits
			if (active && speakerSounds === sounds) stopSpeakers();
		} catch (cause) {
			if (active && speakerSounds === sounds) {
				stopSpeakers();
				errors.audiooutput = voiceDeviceError(cause);
			}
		}
	}

	function saveDefaults(): void {
		errors.defaults = '';
		try {
			saveVoicePreferences(preferences());
			saved = { ...preferences() };
		} catch {
			errors.defaults =
				'Could not save defaults in this browser. Your current settings still apply.';
		}
	}

	return {
		get devices() {
			return devices;
		},
		get outputSupported() {
			return outputSupported;
		},
		get mediaSupported() {
			return mediaSupported;
		},
		get busyKind() {
			return busyKind;
		},
		get errors() {
			return errors;
		},
		get defaultsChanged() {
			return defaultsChanged;
		},
		get microphoneTesting() {
			return microphoneState !== 'idle';
		},
		get microphoneStarting() {
			return microphoneState === 'starting';
		},
		get microphoneLevel() {
			return microphoneLevel;
		},
		get speakerTesting() {
			return speakerTesting;
		},
		changeDevice,
		allowDevices,
		changeVolume,
		toggleMicrophoneCheck,
		toggleSpeakerCheck,
		saveDefaults
	};
}
