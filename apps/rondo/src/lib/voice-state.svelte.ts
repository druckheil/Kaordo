// Owns the selected voice connection, settings and cancellation of obsolete joins
import type { RondoApi } from '@kaordo/api-client';
import type { RondoChannel } from '@kaordo/contracts';
import type { VoiceConnection } from '@kaordo/voice-client';
import { emptyVoiceSnapshot } from '@kaordo/voice-client/model';
import { VoiceSounds } from '@kaordo/voice-client/sounds';
import {
	defaultVoicePreferences,
	devicePreferenceKeys,
	loadVoicePreferences,
	type VoicePreferences,
	type VoiceVolumeKey
} from '@kaordo/voice-client/preferences';

export function createRondoVoiceState(
	api: Pick<RondoApi, 'voiceToken' | 'voiceKey'>,
	serverId: () => string | null,
	soundsEnabled: () => boolean
) {
	let connection = $state.raw<VoiceConnection | null>(null);
	let channelId = $state<string | null>(null);
	let busy = $state(false);
	let error = $state('');
	let snapshot = $state(emptyVoiceSnapshot());
	let preferences = $state<VoicePreferences>(defaultVoicePreferences());
	let generation = 0;
	let disposed = false;
	let joining: AbortController | null = null;
	let keyUpdates: AbortController | null = null;
	let keyTimer: ReturnType<typeof setInterval> | undefined;

	function isCurrent(attempt: number, target: RondoChannel): boolean {
		return !disposed && attempt === generation && target.serverId === serverId();
	}

	function subscribe(active: VoiceConnection): void {
		let connectedBefore = false;
		active.subscribe((state) => {
			if (disposed || connection !== active) return;
			if (connectedBefore && !state.connected && !state.reconnecting) {
				error = 'Voice disconnected. Join again to reconnect.';
				void stop();
				return;
			}
			snapshot = state;
			if (state.connected) connectedBefore = true;
		});
	}

	async function stop(preserveBusy = false): Promise<void> {
		generation++;
		joining?.abort();
		joining = null;
		keyUpdates?.abort();
		keyUpdates = null;
		if (keyTimer) clearInterval(keyTimer);
		keyTimer = undefined;
		const previous = connection;
		connection = null;
		channelId = null;
		if (!preserveBusy) busy = false;
		snapshot = emptyVoiceSnapshot();
		await previous?.disconnect();
	}

	async function start(target: RondoChannel): Promise<void> {
		if (disposed || busy) return;
		busy = true;
		error = '';
		const disconnecting = stop(true);
		const attempt = generation;
		const request = new AbortController();
		joining = request;
		const sounds = new VoiceSounds();
		sounds.enabled = soundsEnabled();
		sounds.unlock();
		let attachedSounds = false;
		let ticketKey: ArrayBuffer | undefined;
		try {
			await disconnecting;
			if (!isCurrent(attempt, target)) return;
			const ticket = await api.voiceToken(target.id, request.signal);
			ticketKey = ticket.key;
			if (!isCurrent(attempt, target)) return;
			const { VoiceConnection } = await import('@kaordo/voice-client');
			if (!isCurrent(attempt, target)) return;
			const active = new VoiceConnection(sounds, preferences);
			attachedSounds = true;
			active.setSoundEnabled(soundsEnabled());
			connection = active;
			channelId = target.id;
			subscribe(active);
			try {
				await active.connect(ticket.serverUrl, ticket.participantToken, ticket.key);
			} finally {
				new Uint8Array(ticket.key).fill(0);
			}
			if (!isCurrent(attempt, target)) await active.disconnect();
			else watchKeys(active, target.id, ticket.revision);
		} catch (cause) {
			if (attempt === generation) {
				error = cause instanceof Error ? cause.message : 'Please try again.';
				await stop();
			}
		} finally {
			if (ticketKey) new Uint8Array(ticketKey).fill(0);
			if (joining === request) joining = null;
			if (!attachedSounds) sounds.dispose();
			if (attempt === generation) busy = false;
		}
	}

	function watchKeys(active: VoiceConnection, id: string, revision: number) {
		const request = new AbortController();
		keyUpdates = request;
		let refreshing = false;
		async function refreshKeys(): Promise<void> {
			if (refreshing) return;
			refreshing = true;
			try {
				request.signal.throwIfAborted();
				const next = await api.voiceKey(id, request.signal);
				try {
					request.signal.throwIfAborted();
					if (next.revision !== revision && connection === active) {
						await active.setEncryptionKey(next.key);
						revision = next.revision;
					}
				} finally {
					new Uint8Array(next.key).fill(0);
				}
			} catch {
				if (!request.signal.aborted) {
					error = 'The encrypted call membership could not be verified. Join again to reconnect.';
					await stop();
				}
			} finally {
				refreshing = false;
			}
		}
		keyTimer = setInterval(() => void refreshKeys(), 5000);
	}

	async function changeDevice(kind: MediaDeviceKind, deviceId: string): Promise<void> {
		await connection?.setDevice(kind, deviceId);
		if (!disposed) preferences = { ...preferences, [devicePreferenceKeys[kind]]: deviceId };
	}

	function changeVolume(key: VoiceVolumeKey, value: number): void {
		preferences = { ...preferences, [key]: value };
		connection?.setVolumes(preferences.microphoneVolume, preferences.speakerVolume);
	}

	return {
		get connection() {
			return connection;
		},
		get channelId() {
			return channelId;
		},
		get busy() {
			return busy;
		},
		get error() {
			return error;
		},
		set error(value: string) {
			error = value;
		},
		get snapshot() {
			return snapshot;
		},
		get preferences() {
			return preferences;
		},
		restorePreferences() {
			preferences = loadVoicePreferences();
		},
		changeDevice,
		changeVolume,
		start,
		stop,
		dispose() {
			disposed = true;
			void stop();
		}
	};
}
