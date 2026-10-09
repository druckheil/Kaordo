// Registers device public keys and unlocks account secrets only on approved devices
import { onMount } from 'svelte';
import { createEncryptionApi } from '@kaordo/api-client';
import {
	createAccountKeys,
	destroyAccountKeys,
	localDevice,
	pinAccountKey,
	toBase64,
	wrapAccountKeys,
	unwrapAccountKeys,
	signDeviceTransfer,
	signDeviceRemoval,
	deviceFingerprint,
	installEncryptionSession,
	createRecovery,
	restoreRecovery,
	parseRecoveryFile,
	type RecoveryFile,
	type AccountKeys,
	type LocalDevice
} from '@kaordo/crypto';
import type { EncryptionIdentity } from '@kaordo/contracts';

export function createEncryptionState(baseUrl: string, ownerId: string) {
	const api = createEncryptionApi(baseUrl);
	let phase = $state<'loading' | 'pending' | 'ready' | 'error'>('loading');
	let identity = $state<EncryptionIdentity | null>(null);
	let fingerprint = $state('');
	let error = $state('');
	let busy = $state(false);
	let recoveryReady = $state(false);
	let recovery = $state<RecoveryFile | null>(null);
	let recoveryUpdate: Awaited<ReturnType<typeof createRecovery>>['update'] | undefined;
	let device: LocalDevice | undefined;
	let keys: AccountKeys | undefined;
	let release: (() => void) | undefined;
	const lifetime = new AbortController();
	let refreshing = false;
	function lock() {
		release?.();
		release = undefined;
		keys = undefined;
		phase = 'error';
	}

	async function refresh(force = false) {
		if (refreshing || lifetime.signal.aborted || (busy && !force)) return;
		refreshing = true;
		error = '';
		try {
			device ??= await localDevice(ownerId);
			fingerprint = await deviceFingerprint(toBase64(device.keys.publicKey));
			identity = await api.identity(lifetime.signal);
			if (!identity) {
				if (keys || device.accountPublicKey) {
					lock();
					throw new Error(
						'The existing encryption identity is unavailable. Your keys have been kept; do not reset this account.'
					);
				}
				const fresh = await createAccountKeys();
				try {
					identity = await api.register(
						{
							id: device.id,
							publicKey: toBase64(device.keys.publicKey),
							encryptionPublicKey: toBase64(fresh.encryption.publicKey),
							signingPublicKey: toBase64(fresh.signing.publicKey),
							wrappedKeys: await wrapAccountKeys(fresh, toBase64(device.keys.publicKey), ownerId)
						},
						lifetime.signal
					);
				} finally {
					destroyAccountKeys(fresh);
				}
			} else if (!identity.devices.some((item) => item.id === device!.id)) {
				if (keys) lock();
				identity = await api.register(
					{ id: device.id, publicKey: toBase64(device.keys.publicKey) },
					lifetime.signal
				);
			}
			lifetime.signal.throwIfAborted();
			const own = identity.devices.find((item) => item.id === device!.id);
			if (!own || own.publicKey !== toBase64(device.keys.publicKey)) {
				lock();
				throw new Error('This device identity has changed.');
			}
			if (
				keys &&
				(toBase64(keys.encryption.publicKey) !== identity.encryptionPublicKey ||
					toBase64(keys.signing.publicKey) !== identity.signingPublicKey)
			) {
				lock();
				throw new Error('The account encryption identity changed. Private data has been locked.');
			}
			if (!own.wrappedKeys) {
				if (keys) lock();
				phase = 'pending';
				return;
			}
			if (!keys) {
				if (device.accountPublicKey && device.accountPublicKey !== identity.encryptionPublicKey)
					throw new Error('The account encryption identity has changed.');
				const opened = await unwrapAccountKeys(
					own.wrappedKeys,
					device.keys,
					ownerId,
					identity.encryptionPublicKey,
					identity.signingPublicKey
				);
				try {
					await pinAccountKey(ownerId, identity.encryptionPublicKey);
					device.accountPublicKey = identity.encryptionPublicKey;
					lifetime.signal.throwIfAborted();
					release = installEncryptionSession(ownerId, opened, lifetime.signal);
					keys = opened;
				} catch (cause) {
					destroyAccountKeys(opened);
					throw cause;
				}
			}
			phase = 'ready';
		} catch (cause) {
			if (!lifetime.signal.aborted) {
				error = cause instanceof Error ? cause.message : 'Device encryption could not open.';
				if (!keys) phase = 'error';
			}
		} finally {
			refreshing = false;
		}
	}

	async function prepareRecovery() {
		if (!keys || busy) return;
		busy = true;
		error = '';
		recoveryReady = false;
		try {
			const current = await api.recovery(lifetime.signal);
			const next = await createRecovery(keys, ownerId, current);
			recovery = next.file;
			recoveryUpdate = next.update;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Recovery could not be prepared.';
		} finally {
			busy = false;
		}
	}
	async function activateRecovery() {
		if (!recoveryUpdate || busy) return;
		busy = true;
		error = '';
		try {
			await api.saveRecovery(recoveryUpdate, lifetime.signal);
			recoveryReady = true;
			recoveryUpdate = undefined;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Recovery could not be saved.';
		} finally {
			busy = false;
		}
	}
	async function recover(secretOrFile: string, replaceDeviceId?: string) {
		if (!device || !identity || busy) return;
		busy = true;
		error = '';
		let restored: AccountKeys | undefined;
		try {
			const secret = secretOrFile.trim().startsWith('{')
				? parseRecoveryFile(
						secretOrFile,
						ownerId,
						identity.encryptionPublicKey,
						identity.signingPublicKey
					)
				: secretOrFile;
			const wrapped = await api.recovery(lifetime.signal);
			if (!wrapped) throw new Error('No recovery key has been activated for this account.');
			restored = await restoreRecovery(
				secret,
				wrapped,
				ownerId,
				identity.encryptionPublicKey,
				identity.signingPublicKey
			);
			if (!identity.devices.some((item) => item.id === device!.id)) {
				if (identity.devices.length >= 20) {
					const lost = identity.devices.find((item) => item.id === replaceDeviceId);
					if (!lost) throw new Error('Choose a lost device to make room for this one.');
					identity = await api.forgetDevice(
						lost.id,
						await signDeviceRemoval(restored, ownerId, lost),
						lifetime.signal
					);
				}
				identity = await api.register(
					{ id: device.id, publicKey: toBase64(device.keys.publicKey) },
					lifetime.signal
				);
			}
			const wrappedKeys = await wrapAccountKeys(restored, toBase64(device.keys.publicKey), ownerId);
			const signature = await signDeviceTransfer(
				restored,
				ownerId,
				device.id,
				toBase64(device.keys.publicKey),
				wrappedKeys
			);
			identity = await api.approve(device.id, { wrappedKeys, signature }, lifetime.signal);
			await refresh(true);
		} catch (cause) {
			error =
				cause instanceof Error ? cause.message : 'The recovery key could not unlock this account.';
		} finally {
			if (restored) destroyAccountKeys(restored);
			busy = false;
		}
	}
	function clearRecovery() {
		recovery = null;
		recoveryUpdate = undefined;
		recoveryReady = false;
	}

	async function approve(id: string) {
		const target = identity?.devices.find((item) => item.id === id);
		if (!keys || !target || target.wrappedKeys || busy) return;
		busy = true;
		error = '';
		try {
			const wrappedKeys = await wrapAccountKeys(keys, target.publicKey, ownerId);
			const signature = await signDeviceTransfer(keys, ownerId, id, target.publicKey, wrappedKeys);
			identity = await api.approve(id, { wrappedKeys, signature }, lifetime.signal);
		} catch (cause) {
			if (!lifetime.signal.aborted)
				error = cause instanceof Error ? cause.message : 'The device could not be approved.';
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		void refresh();
		let lastRefresh = 0;
		const timer = setInterval(() => {
			if (
				document.visibilityState === 'visible' &&
				Date.now() - lastRefresh >= (phase === 'ready' ? 15000 : 3000)
			) {
				lastRefresh = Date.now();
				void refresh();
			}
		}, 3000);
		return () => {
			clearInterval(timer);
			lifetime.abort();
			release?.();
			device?.keys.privateKey.fill(0);
		};
	});
	return {
		get phase() {
			return phase;
		},
		get identity() {
			return identity;
		},
		get fingerprint() {
			return fingerprint;
		},
		get deviceId() {
			return device?.id;
		},
		get error() {
			return error;
		},
		get busy() {
			return busy;
		},
		get recovery() {
			return recovery;
		},
		get recoveryReady() {
			return recoveryReady;
		},
		prepareRecovery,
		activateRecovery,
		recover,
		clearRecovery,
		refresh,
		approve
	};
}
