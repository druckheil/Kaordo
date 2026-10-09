// Provides typed Rondo server and voice requests with server query options

import type {
	RondoDetail,
	RondoNewServer,
	RondoServerPage,
	RondoChannel,
	RondoVoiceTicket,
	paths
} from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, requireResponseOk, sessionFetch } from './http.ts';
import { createContentCodec } from './content-codec.ts';
import { createRondoContent, validateName } from './rondo-content.ts';
import { envelopeText, encryptionSession, fromBase64, toBase64 } from '@kaordo/crypto';

export function createRondoApi(apiBaseUrl: string) {
	const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
	const codec = createContentCodec(apiBaseUrl);
	const content = createRondoContent(codec);
	async function wireDetail(id: string, signal?: AbortSignal) {
		const { data, error, response } = await client.GET('/v1/rondo/servers/{id}', {
			params: { path: { id } },
			signal
		});
		return requireResponseData(data, error, response.status);
	}
	async function voiceKey(id: string, signal?: AbortSignal) {
		let { data, error, response } = await client.GET('/v1/rondo/channels/{id}/voice-key', {
			params: { path: { id } },
			signal
		});
		let value = requireResponseData(data, error, response.status);
		if (!value.envelope) {
			const channel = await findChannel(id, signal);
			const key = toBase64(crypto.getRandomValues(new Uint8Array(32)));
			const envelope = await codec.seal(
				{ key },
				`rondo-voice:${id}:${value.membershipTag}`,
				'rondo',
				channel.serverId,
				true
			);
			const written = await client.PUT('/v1/rondo/channels/{id}/voice-key', {
				params: { path: { id } },
				body: { ...value, envelope },
				signal
			});
			if (written.response.status === 409) {
				({ data, error, response } = await client.GET('/v1/rondo/channels/{id}/voice-key', {
					params: { path: { id } },
					signal
				}));
				value = requireResponseData(data, error, response.status);
			} else value = requireResponseData(written.data, written.error, written.response.status);
		}
		if (!value.envelope) throw new Error('Voice membership changed. Try joining again.');
		const body = await codec.open<{ key: string }>(
			value.envelope,
			value.envelope.senderId,
			`rondo-voice:${id}:${value.membershipTag}`
		);
		return { revision: value.revision, key: fromBase64(body.key, 32).buffer };
	}
	const channelServers = new Map<string, RondoChannel>();
	encryptionSession().signal.addEventListener('abort', () => channelServers.clear(), {
		once: true
	});
	async function findChannel(id: string, signal?: AbortSignal) {
		const known = channelServers.get(id);
		if (known) return known;
		const { data, error, response } = await client.GET('/v1/rondo/servers', { signal });
		for (const server of requireResponseData(data, error, response.status).items) {
			const detail = await wireDetail(server.id, signal);
			for (const channel of detail.channels) channelServers.set(channel.id, channel);
			if (channelServers.has(id)) return channelServers.get(id)!;
		}
		throw new Error('Voice channel is unavailable.');
	}
	return {
		async list(search = '', signal?: AbortSignal): Promise<RondoServerPage> {
			const { data, error, response } = await client.GET('/v1/rondo/servers', {
				signal
			});
			const result = requireResponseData(data, error, response.status);
			const items = await Promise.all(result.items.map((item) => content.server(item)));
			return {
				items: items.filter(
					(item) => !search || item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
				)
			};
		},
		async discover(search = '', signal?: AbortSignal): Promise<RondoServerPage> {
			const query = search.toLocaleLowerCase().trim();
			const items: RondoServerPage['items'] = [];
			let cursor: string | undefined;
			do {
				signal?.throwIfAborted();
				const { data, error, response } = await client.GET('/v1/rondo/discover', {
					params: { query: { cursor } },
					signal
				});
				const page = requireResponseData(data, error, response.status);
				for (const item of page.items) {
					const opened = await content.server(item);
					if (!query || opened.name.toLocaleLowerCase().includes(query)) items.push(opened);
				}
				cursor = page.nextCursor ?? undefined;
			} while (query && cursor && items.length < 50);
			return { items, nextCursor: cursor ?? null };
		},
		async create(input: RondoNewServer, signal?: AbortSignal): Promise<RondoDetail> {
			validateName(input.name, 100);
			if ([...input.description].length > 500)
				throw new Error('Use up to 500 characters for the description.');
			const id = crypto.randomUUID();
			const generalId = crypto.randomUUID();
			const owner = encryptionSession().ownerId;
			const name = envelopeText(
				await codec.seal(
					{ name: input.name, description: input.description },
					`rondo:${id}`,
					'rondo',
					owner,
					input.access === 'private'
				)
			);
			const general = envelopeText(
				await codec.seal(
					{ name: 'general' },
					`rondo-channel:${id}:${generalId}`,
					'rondo',
					owner,
					input.access === 'private'
				)
			);
			const { data, error, response } = await client.POST('/v1/rondo/servers', {
				body: { ...input, id, generalId, name, general, description: '' },
				signal
			});
			return content.detail(requireResponseData(data, error, response.status));
		},
		async get(id: string, signal?: AbortSignal): Promise<RondoDetail> {
			const { data, error, response } = await client.GET('/v1/rondo/servers/{id}', {
				params: { path: { id } },
				signal
			});
			const value = requireResponseData(data, error, response.status);
			for (const channel of value.channels) channelServers.set(channel.id, channel);
			return content.detail(value);
		},
		async join(id: string, signal?: AbortSignal): Promise<RondoDetail> {
			const { data, error, response } = await client.POST('/v1/rondo/servers/{id}/join', {
				params: { path: { id } },
				signal
			});
			return content.detail(requireResponseData(data, error, response.status));
		},
		async invite(id: string, userId: string, signal?: AbortSignal): Promise<RondoDetail> {
			const original = await wireDetail(id, signal);
			const value = await content.detail(original);
			const { data, error, response } = await client.POST('/v1/rondo/servers/{id}/members', {
				params: { path: { id } },
				body: { userId, ...(await content.metadata(value, original.server.name, userId)) },
				signal
			});
			return content.detail(requireResponseData(data, error, response.status));
		},
		async leave(id: string, signal?: AbortSignal): Promise<void> {
			const { error, response } = await client.DELETE('/v1/rondo/servers/{id}/membership', {
				params: { path: { id } },
				signal
			});
			requireResponseOk(response, error);
		},
		async createChannel(id: string, name: string, signal?: AbortSignal): Promise<RondoChannel> {
			validateName(name, 80);
			const channelId = crypto.randomUUID();
			const value = await wireDetail(id, signal);
			const encrypted = envelopeText(
				await codec.seal({ name }, `rondo-channel:${id}:${channelId}`, 'rondo', id)
			);
			const { data, error, response } = await client.POST('/v1/rondo/servers/{id}/channels', {
				params: { path: { id } },
				body: { id: channelId, name: encrypted },
				signal
			});
			const result = requireResponseData(data, error, response.status);
			channelServers.set(result.id, result);
			return content.channel(result, value.server.ownerId);
		},
		voiceKey,
		async voiceToken(id: string, signal?: AbortSignal) {
			const { data, error, response } = await client.POST('/v1/rondo/channels/{id}/voice-token', {
				params: { path: { id } },
				signal
			});
			return {
				...requireResponseData(data, error, response.status),
				...(await voiceKey(id, signal))
			};
		}
	};
}

export type RondoApi = ReturnType<typeof createRondoApi>;

export function rondoServersOptions(api: RondoApi) {
	return {
		queryKey: ['rondo', 'servers'] as const,
		queryFn: ({ signal }: { signal: AbortSignal }) => api.list('', signal),
		staleTime: 15_000,
		refetchInterval: 30_000
	};
}

export function rondoDiscoverOptions(api: RondoApi, search: string, enabled: boolean) {
	return {
		queryKey: ['rondo', 'discover', search] as const,
		queryFn: ({ signal }: { signal: AbortSignal }) => api.discover(search, signal),
		enabled,
		staleTime: 15_000
	};
}

export function rondoServerOptions(api: RondoApi, id: string | null) {
	return {
		queryKey: ['rondo', 'server', id] as const,
		queryFn: ({ signal }: { signal: AbortSignal }) => {
			if (!id) throw new Error('A server must be selected.');
			return api.get(id, signal);
		},
		enabled: !!id,
		staleTime: 15_000,
		refetchInterval: 30_000
	};
}
