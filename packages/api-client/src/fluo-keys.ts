// Keeps the author's audience keys aligned with privacy and follows, and resolves keys needed to open posts
import createClient from 'openapi-fetch';
import type { paths } from '@kaordo/contracts';
import {
	encryptionSession,
	ownAudienceKey,
	sealAudienceKey,
	openAudienceKey,
	pinPeerIdentity,
	toBase64,
	fromBase64,
	type KeyRef
} from '@kaordo/crypto';
import { requireResponseData, sessionFetch } from './http.ts';

type KeyringState =
	paths['/v1/fluo/keyring']['get']['responses']['200']['content']['application/json'];
type KeyringUpdate =
	paths['/v1/fluo/keyring']['post']['requestBody']['content']['application/json'];

export function createFluoKeys(baseUrl: string) {
	const client = createClient<paths>({ baseUrl, fetch: sessionFetch });
	const session = encryptionSession();
	const keys = new Map<string, Promise<Uint8Array | null>>();
	let current: Promise<number> | undefined;
	session.signal.addEventListener(
		'abort',
		() => {
			for (const pending of keys.values())
				void pending.then(
					(key) => key?.fill(0),
					() => {
						// Failed loads contain no key material to wipe
					}
				);
			keys.clear();
			current = undefined;
		},
		{ once: true }
	);

	function own(version: number) {
		const id = `${session.ownerId}:${version}`;
		let key = keys.get(id);
		if (!key) {
			key = ownAudienceKey(version);
			keys.set(id, key);
		}
		return key as Promise<Uint8Array>;
	}
	// Published keys allow public reading; private accounts seal unpublished versions to the accounts they follow.
	function plan(state: KeyringState): KeyringUpdate | null {
		const latest = state.versions.at(-1);
		const update: KeyringUpdate = { create: 0, publish: [], grants: [] };
		if (!latest || (state.accountVisibility === 'private' && latest.published))
			update.create = (latest?.version ?? 0) + 1;
		return update.create ||
			state.missing.length ||
			(state.accountVisibility === 'public' && state.versions.some((item) => !item.published))
			? update
			: null;
	}
	async function fill(state: KeyringState, update: KeyringUpdate) {
		if (state.accountVisibility === 'public') {
			const versions = [
				...state.versions.filter((item) => !item.published).map((item) => item.version),
				...(update.create ? [update.create] : [])
			];
			for (const version of versions)
				update.publish.push({ version, key: toBase64(await own(version)) });
		}
		for (const missing of state.missing) {
			await pinPeerIdentity(
				session.ownerId,
				missing.recipient.id,
				missing.recipient.encryptionPublicKey,
				missing.recipient.signingPublicKey
			);
			for (const version of missing.versions)
				update.grants.push({
					recipientId: missing.recipient.id,
					version,
					sealedKey: await sealAudienceKey(
						await own(version),
						missing.recipient.encryptionPublicKey
					)
				});
		}
	}
	async function sync(): Promise<number> {
		const read = await client.GET('/v1/fluo/keyring', { signal: session.signal });
		let state = requireResponseData(read.data, read.error, read.response.status);
		// A newly created private version is granted on the following pass.
		for (let pass = 0; pass < 3; pass++) {
			const update = plan(state);
			if (!update) break;
			await fill(state, update);
			const written = await client.POST('/v1/fluo/keyring', {
				body: update,
				signal: session.signal
			});
			state = requireResponseData(written.data, written.error, written.response.status);
		}
		const latest = state.versions.at(-1);
		if (!latest) throw new Error('Your audience key could not be prepared.');
		return latest.version;
	}
	function refresh() {
		current = sync();
		void current.catch(() => {
			current = undefined;
		});
		return current;
	}

	function fetchMissing(refs: KeyRef[]) {
		for (let offset = 0; offset < refs.length; offset += 100) {
			const chunk = refs.slice(offset, offset + 100);
			const pending = Promise.resolve(
				client.GET('/v1/fluo/keys', {
					params: {
						query: { refs: chunk.map((ref) => `${ref.ownerId}:${ref.version}`).join(',') }
					},
					signal: session.signal
				})
			).then(
				({ data, error, response }) => requireResponseData(data, error, response.status).items
			);
			for (const ref of chunk) {
				keys.set(
					`${ref.ownerId}:${ref.version}`,
					pending.then(async (items) => {
						const item = items.find(
							(value) => value.ownerId === ref.ownerId && value.version === ref.version
						);
						if (item?.publicKey) return fromBase64(item.publicKey, 32);
						return item?.sealedKey ? openAudienceKey(item.sealedKey) : null;
					})
				);
			}
		}
	}
	return {
		/** Current audience key version, reconciling grants and rotation on first use */
		current: () => current ?? refresh(),
		refresh,
		own,
		/** Keys in keyring order, or null when the viewer has not been granted one of them */
		async resolve(refs: KeyRef[]): Promise<Uint8Array[] | null> {
			const missing = refs.filter(
				(ref) => ref.ownerId !== session.ownerId && !keys.has(`${ref.ownerId}:${ref.version}`)
			);
			if (missing.length) fetchMissing(missing);
			const resolved = await Promise.all(
				refs.map((ref) =>
					ref.ownerId === session.ownerId
						? own(ref.version)
						: (keys.get(`${ref.ownerId}:${ref.version}`) ?? Promise.resolve(null))
				)
			);
			if (resolved.some((key) => !key)) {
				// Grants can arrive later, so unavailable keys are fetched again next time.
				refs.forEach((ref, index) => {
					if (!resolved[index]) keys.delete(`${ref.ownerId}:${ref.version}`);
				});
				return null;
			}
			return resolved as Uint8Array[];
		}
	};
}
export type FluoKeys = ReturnType<typeof createFluoKeys>;
