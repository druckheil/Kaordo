// Manages LiveKit connections, participant state, tracks and local voice controls
import {
	ConnectionState,
	ExternalE2EEKeyProvider,
	isE2EESupported,
	LocalAudioTrack,
	RemoteAudioTrack,
	Room,
	RoomEvent,
	ScreenSharePresets,
	Track,
	VideoPresets,
	supportsAudioOutputSelection,
	type RemoteParticipant,
	type RemoteTrack
} from 'livekit-client';
import { type ScreenQuality, type VoiceSnapshot, type VoiceVideo } from './model.js';
import { participantSnapshots } from './participant-state.js';
import { VoiceSounds } from './sounds.js';
import { MicrophoneVolume } from './microphone-volume.js';
import {
	clampVoiceVolume,
	defaultVoicePreferences,
	devicePreferenceKeys,
	type VoicePreferences
} from './preferences.js';

const screenPresets = {
	'360p15': ScreenSharePresets.h360fps15,
	'720p5': ScreenSharePresets.h720fps5,
	'720p15': ScreenSharePresets.h720fps15,
	'720p30': ScreenSharePresets.h720fps30,
	'1080p15': ScreenSharePresets.h1080fps15,
	'1080p30': ScreenSharePresets.h1080fps30,
	original: ScreenSharePresets.original
} as const;

const controlSoundCues = [
	['microphoneEnabled', 'unmute', 'mute'],
	['cameraEnabled', 'cameraOn', 'cameraOff'],
	['screenShareEnabled', 'screenOn', 'screenOff']
] as const;

type LocalControls = Pick<
	VoiceSnapshot,
	'microphoneEnabled' | 'cameraEnabled' | 'screenShareEnabled'
>;

export class VoiceConnection {
	private readonly room: Room;
	private readonly keyProvider = new ExternalE2EEKeyProvider();
	private readonly encryptionWorker: Worker;
	private readonly microphoneVolume = new MicrophoneVolume();
	private readonly preferences: VoicePreferences;
	private readonly audioElements = new Set<HTMLMediaElement>();
	private readonly sounds: VoiceSounds;
	private listener: ((state: VoiceSnapshot) => void) | undefined;
	private connected = false;
	private initializing = true;
	private suppressControlCues = false;
	private lastControls: LocalControls | null = null;
	private deafened = false;
	private microphoneBeforeDeafen = false;
	private disposed = false;
	private disconnectPromise?: Promise<void>;
	private encryptionFailure?: Error;

	constructor(sounds = new VoiceSounds(), preferences = defaultVoicePreferences()) {
		if (!isE2EESupported())
			throw new Error(
				'This browser does not support encrypted calls. Use an up-to-date supported browser.'
			);
		this.sounds = sounds;
		this.preferences = { ...preferences };
		this.encryptionWorker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url));
		this.room = new Room({
			encryption: { keyProvider: this.keyProvider, worker: this.encryptionWorker },
			adaptiveStream: true,
			dynacast: true,
			audioCaptureDefaults: {
				deviceId: preferences.microphoneId === 'default' ? undefined : preferences.microphoneId,
				autoGainControl: false
			},
			videoCaptureDefaults: {
				deviceId: preferences.cameraId === 'default' ? undefined : preferences.cameraId,
				resolution: VideoPresets.h720.resolution
			}
		});
		this.setVolumes(preferences.microphoneVolume, preferences.speakerVolume);
		this.bindRoomEvents();
	}

	private bindRoomEvents(): void {
		const update = () => this.emit();
		const stateEvents = [
			RoomEvent.ActiveSpeakersChanged,
			RoomEvent.TrackPublished,
			RoomEvent.TrackUnpublished,
			RoomEvent.TrackMuted,
			RoomEvent.TrackUnmuted,
			RoomEvent.AudioPlaybackStatusChanged,
			RoomEvent.VideoPlaybackStatusChanged,
			RoomEvent.LocalTrackPublished,
			RoomEvent.LocalTrackUnpublished,
			RoomEvent.ConnectionStateChanged,
			RoomEvent.ParticipantNameChanged
		];
		for (const event of stateEvents) this.room.on(event, update);
		this.room.on(RoomEvent.ParticipantConnected, this.onParticipantConnected);
		this.room.on(RoomEvent.ParticipantDisconnected, this.onParticipantDisconnected);
		this.room.on(RoomEvent.TrackSubscribed, this.onTrackSubscribed);
		this.room.on(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed);
		this.room.on(RoomEvent.EncryptionError, () => {
			this.encryptionFailure = new Error(
				'The encrypted call could not be verified. Join again to reconnect.'
			);
			void this.room.disconnect();
		});
	}

	private onParticipantConnected = (participant: RemoteParticipant): void => {
		this.applyParticipantVolume(participant);
		if (this.room.state === ConnectionState.Connected && this.connected)
			this.sounds.play('connect');
		this.emit();
	};

	private onParticipantDisconnected = (): void => {
		if (this.room.state === ConnectionState.Connected && this.connected)
			this.sounds.play('disconnect');
		this.emit();
	};

	private onTrackSubscribed = (track: RemoteTrack): void => {
		if (track.kind === Track.Kind.Audio) this.attachAudio(track);
		this.emit();
	};

	private onTrackUnsubscribed = (track: RemoteTrack): void => {
		if (track.kind === Track.Kind.Audio) this.detachAudio(track);
		this.emit();
	};

	private attachAudio(track: RemoteTrack): void {
		if (track instanceof RemoteAudioTrack) track.setVolume(this.preferences.speakerVolume / 100);
		const element = track.attach();
		element.className = 'sr-only';
		element.muted = this.deafened;
		document.body.append(element);
		this.audioElements.add(element);
	}

	private applyParticipantVolume(participant: RemoteParticipant): void {
		participant.setVolume(this.preferences.speakerVolume / 100);
		participant.setVolume(this.preferences.speakerVolume / 100, Track.Source.ScreenShareAudio);
	}

	setVolumes(microphone: number, speakers: number): void {
		this.preferences.microphoneVolume = clampVoiceVolume(microphone);
		this.preferences.speakerVolume = clampVoiceVolume(speakers);
		this.microphoneVolume.setVolume(this.preferences.microphoneVolume);
		this.sounds.setVolume(this.preferences.speakerVolume);
		for (const participant of this.room.remoteParticipants.values())
			this.applyParticipantVolume(participant);
	}

	async setDevice(kind: MediaDeviceKind, deviceId: string): Promise<void> {
		if (this.disposed) return;
		if (kind === 'audiooutput' && !supportsAudioOutputSelection()) {
			if (deviceId !== 'default')
				throw new Error('Choose the output device in your system settings.');
		} else {
			const id = kind === 'audiooutput' && deviceId === 'default' ? '' : deviceId;
			const switched = await this.room.switchActiveDevice(kind, id, deviceId !== 'default');
			// System default is an ideal constraint that can resolve to a concrete device ID
			if (!switched && deviceId !== 'default')
				throw new Error('This device is unavailable. Connect it or choose another device.');
		}
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Disconnect can dispose the connection while device switching awaits
		if (this.disposed) return;
		this.preferences[devicePreferenceKeys[kind]] = deviceId;
		if (kind === 'audiooutput') await this.routeSounds();
	}

	private async routeSounds(): Promise<void> {
		try {
			await this.sounds.setOutput(this.preferences.speakerId);
		} catch {
			// Optional interface sounds must not interrupt calls or output selection
		}
	}

	private async enableMicrophone(): Promise<void> {
		if (this.disposed) return;
		const local = this.room.localParticipant;
		const existing = local.getTrackPublication(Track.Source.Microphone)?.audioTrack;
		if (existing) {
			if (existing.getProcessor() !== this.microphoneVolume)
				await existing.setProcessor(this.microphoneVolume);
			await local.setMicrophoneEnabled(true);
			return;
		}
		const captureDeviceId = this.preferences.microphoneId;
		const tracks = await local.createTracks({ audio: true });
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Disconnect can dispose the connection while media permission awaits
		if (this.disposed) {
			for (const track of tracks) track.stop();
			return;
		}
		try {
			for (const track of tracks) {
				if (track instanceof LocalAudioTrack) {
					if (captureDeviceId !== this.preferences.microphoneId) {
						const id = this.preferences.microphoneId;
						await track.setDeviceId(id === 'default' ? id : { exact: id });
					}
					await track.setProcessor(this.microphoneVolume);
				}
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Disconnect can dispose the connection while a track is prepared
				if (this.disposed) {
					track.stop();
					continue;
				}
				await local.publishTrack(track);
			}
		} catch (cause) {
			for (const track of tracks) track.stop();
			await this.microphoneVolume.destroy();
			throw cause;
		}
	}

	setSoundEnabled(enabled: boolean): void {
		this.sounds.enabled = enabled;
		if (enabled) {
			this.sounds.unlock();
			void this.routeSounds();
		}
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
		const reconnecting =
			this.room.state === ConnectionState.Reconnecting ||
			this.room.state === ConnectionState.SignalReconnecting;
		const controls = this.controls();
		this.playConnectionCue(connected);
		this.playControlCues(connected, controls);
		this.rememberConnectionState(connected, controls);

		const { participants, videos } = participantSnapshots(this.room, connected || reconnecting);
		this.listener?.({
			connected,
			reconnecting,
			...controls,
			deafened: this.deafened,
			canPlaybackAudio: this.room.canPlaybackAudio,
			canPlaybackVideo: this.room.canPlaybackVideo,
			participants,
			videos
		});
	}

	private playConnectionCue(connected: boolean): void {
		if (connected && !this.connected) this.sounds.play('connect');
		else if (this.room.state === ConnectionState.Disconnected && this.connected)
			this.sounds.play('disconnect');
	}

	private playControlCues(connected: boolean, controls: LocalControls): void {
		if (!connected || this.initializing || this.suppressControlCues || !this.lastControls) return;
		for (const [key, enabledCue, disabledCue] of controlSoundCues) {
			if (controls[key] !== this.lastControls[key]) {
				this.sounds.play(controls[key] ? enabledCue : disabledCue);
			}
		}
	}

	private rememberConnectionState(connected: boolean, controls: LocalControls): void {
		if (connected || this.room.state === ConnectionState.Disconnected) this.connected = connected;
		this.lastControls = connected ? controls : null;
	}

	attachVideo(video: VoiceVideo, element: HTMLVideoElement): () => void {
		const participant = video.local
			? this.room.localParticipant
			: this.room.remoteParticipants.get(video.participantId);
		const trackSource = video.source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare;
		const publication = participant?.getTrackPublication(trackSource);
		const track = publication?.trackSid === video.trackSid ? publication.videoTrack : undefined;
		if (!track)
			return () => {
				// No subscribed track means there is nothing to detach
			};

		element.autoplay = true;
		element.playsInline = true;
		element.muted = video.local;
		track.attach(element);
		return () => track.detach(element);
	}

	async connect(serverUrl: string, token: string, encryptionKey: ArrayBuffer): Promise<void> {
		if (this.disposed) return;
		await this.setEncryptionKey(encryptionKey);
		await this.room.setE2EEEnabled(true);
		this.sounds.unlock();
		await this.room.connect(serverUrl, token);
		if (this.encryptionFailure) throw this.encryptionFailure;
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Disconnect can dispose the connection while LiveKit connects
		if (this.disposed) {
			await this.room.disconnect();
			return;
		}
		if (this.preferences.speakerId !== 'default') {
			try {
				await this.setDevice('audiooutput', this.preferences.speakerId);
			} catch {
				await this.setDevice('audiooutput', 'default');
			}
		}
		for (const participant of this.room.remoteParticipants.values())
			this.applyParticipantVolume(participant);
		this.emit();
		try {
			await this.enableMicrophone();
		} catch {
			// Keep the connection available in listen-only mode when microphone access is denied.
		}
		this.initializing = false;
		this.lastControls = this.controls();
		this.emit();
	}

	async setEncryptionKey(key: ArrayBuffer): Promise<void> {
		if (key.byteLength !== 32) throw new Error('An encrypted call requires a valid room key.');
		if (!this.disposed) await this.keyProvider.setKey(key);
	}

	async toggleMicrophone(): Promise<void> {
		if (this.deafened) throw new Error('Undeafen before using the microphone.');
		this.sounds.unlock();
		if (this.room.localParticipant.isMicrophoneEnabled)
			await this.room.localParticipant.setMicrophoneEnabled(false);
		else await this.enableMicrophone();
		this.emit();
	}

	async toggleDeafen(): Promise<void> {
		this.sounds.unlock();
		this.suppressControlCues = true;
		const next = !this.deafened;
		try {
			await this.applyDeafenState(next);
		} finally {
			this.lastControls = this.controls();
			this.suppressControlCues = false;
			this.emit();
		}
	}

	private async applyDeafenState(deafened: boolean): Promise<void> {
		const microphone = this.room.localParticipant;
		if (deafened) {
			this.microphoneBeforeDeafen = microphone.isMicrophoneEnabled;
			await microphone.setMicrophoneEnabled(false);
		}

		this.deafened = deafened;
		this.setRemoteAudioMuted(deafened);
		await this.restoreMicrophoneAfterDeafen(deafened);
		this.sounds.play(deafened ? 'deafen' : 'undeafen');
	}

	private setRemoteAudioMuted(muted: boolean): void {
		for (const element of this.audioElements) element.muted = muted;
	}

	private async restoreMicrophoneAfterDeafen(deafened: boolean): Promise<void> {
		if (deafened || !this.microphoneBeforeDeafen) return;
		this.microphoneBeforeDeafen = false;
		await this.enableMicrophone();
	}

	async toggleCamera(): Promise<void> {
		this.sounds.unlock();
		const enabled = !this.room.localParticipant.isCameraEnabled;
		const captureOptions = enabled ? { resolution: VideoPresets.h720.resolution } : undefined;
		const publishOptions = enabled ? { videoEncoding: VideoPresets.h720.encoding } : undefined;
		await this.room.localParticipant.setCameraEnabled(enabled, captureOptions, publishOptions);
		this.emit();
	}

	async toggleScreenShare(quality: ScreenQuality = '1080p15', includeAudio = false): Promise<void> {
		this.sounds.unlock();
		const enabled = !this.room.localParticipant.isScreenShareEnabled;
		const preset = screenPresets[quality];
		const captureOptions = enabled
			? {
					resolution: preset.resolution,
					audio: includeAudio,
					contentHint: quality.endsWith('30') ? ('motion' as const) : ('detail' as const)
				}
			: undefined;
		const publishOptions = enabled ? { screenShareEncoding: preset.encoding } : undefined;
		await this.room.localParticipant.setScreenShareEnabled(enabled, captureOptions, publishOptions);
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

	disconnect(): Promise<void> {
		if (this.disconnectPromise) return this.disconnectPromise;
		this.disposed = true;
		this.listener = undefined;
		this.disconnectPromise = this.disconnectRoom();
		return this.disconnectPromise;
	}

	private async disconnectRoom(): Promise<void> {
		try {
			await this.room.disconnect();
		} finally {
			this.emit();
			this.removeAudioElements();
			this.sounds.dispose(420);
			this.encryptionWorker.terminate();
		}
	}

	private removeAudioElements(): void {
		for (const element of this.audioElements) element.remove();
		this.audioElements.clear();
	}
}
