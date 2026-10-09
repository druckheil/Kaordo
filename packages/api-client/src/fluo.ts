// Provides typed Fluo and Nodo requests plus their feed pagination options

import type {
	FluoNewPost,
	FluoPage,
	FluoPost,
	FluoPostThread,
	FluoNotificationPage,
	FluoNotificationSummary,
	FluoNotificationReadState,
	FluoSettings,
	FluoSettingsPatch,
	FluoProfile,
	FluoProfileUpdate,
	FluoStatus,
	FluoConnectionPage,
	NodoUpload,
	paths
} from '@kaordo/contracts';
import { createContentCodec } from './content-codec.ts';
import { createFluoContent } from './fluo-content.ts';
import { createFluoKeys } from './fluo-keys.ts';
import { isFluoEnvelope } from '@kaordo/crypto';
import createClient from 'openapi-fetch';
import { requireResponseData, requireResponseOk, sessionFetch } from './http.ts';

export type Feed = 'latest' | 'following' | 'mine' | 'saved';
export interface FluoFeedFilter {
	feed: Feed;
	search?: string;
	authorId?: string;
}

export function createFluoApi(apiBaseUrl: string, nodoBaseUrl: string) {
	const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: sessionFetch });
	const nodoClient = createClient<paths>({
		baseUrl: nodoBaseUrl.replace(/\/$/, ''),
		fetch: sessionFetch
	});
	const keys = createFluoKeys(apiBaseUrl);
	async function wirePost(id: string, signal?: AbortSignal) {
		const { data, error, response } = await client.GET('/v1/fluo/posts/{id}', {
			params: { path: { id } },
			signal
		});
		return requireResponseData(data, error, response.status);
	}
	const content = createFluoContent(createContentCodec(apiBaseUrl), keys, async (id) => {
		const parent = await wirePost(id);
		if (!isFluoEnvelope(parent.content)) throw new Error('The replied post is not encrypted.');
		return parent.content.keyring;
	});

	return {
		/** Grants and rotates audience keys after follows or privacy changes made on any device */
		syncKeys: () => keys.refresh(),
		async profile(username: string, signal?: AbortSignal): Promise<FluoProfile> {
			const { data, error, response } = await client.GET('/v1/fluo/profiles/{username}', {
				params: { path: { username } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async updateProfile(input: FluoProfileUpdate, signal?: AbortSignal): Promise<FluoProfile> {
			const { data, error, response } = await client.PUT('/v1/fluo/profile', {
				body: input,
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async setStatus(status: FluoStatus, signal?: AbortSignal): Promise<FluoProfile> {
			const { data, error, response } = await client.PUT('/v1/fluo/profile/status', {
				body: { status },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async connections(
			id: string,
			kind: 'followers' | 'following',
			cursor?: string,
			signal?: AbortSignal
		): Promise<FluoConnectionPage> {
			const { data, error, response } = await client.GET('/v1/fluo/users/{id}/connections', {
				params: { path: { id }, query: { kind, cursor, limit: 20 } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async settings(signal?: AbortSignal): Promise<FluoSettings> {
			const { data, error, response } = await client.GET('/v1/fluo/settings', { signal });
			return requireResponseData(data, error, response.status);
		},
		async updateSettings(patch: FluoSettingsPatch, signal?: AbortSignal): Promise<FluoSettings> {
			const { data, error, response } = await client.PATCH('/v1/fluo/settings', {
				body: patch,
				signal
			});
			const settings = requireResponseData(data, error, response.status);
			// Rotation is retried by the next post if this device cannot finish it now.
			if (patch.privacy?.accountVisibility)
				await keys.refresh().catch(() => {
					// The active post operation reports key errors; background synchronization is best effort
				});
			return settings;
		},
		async notifications(cursor?: string, signal?: AbortSignal): Promise<FluoNotificationPage> {
			const { data, error, response } = await client.GET('/v1/fluo/notifications', {
				params: { query: { cursor, limit: 20 } },
				signal
			});
			const result = requireResponseData(data, error, response.status);
			return {
				...result,
				items: await Promise.all(result.items.map((item) => content.notification(item, signal)))
			};
		},
		async notificationSummary(signal?: AbortSignal): Promise<FluoNotificationSummary> {
			const { data, error, response } = await client.GET('/v1/fluo/notifications/unread-count', {
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async readNotification(id: string, signal?: AbortSignal): Promise<FluoNotificationReadState> {
			const { data, error, response } = await client.PUT('/v1/fluo/notifications/{id}/read', {
				params: { path: { id } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async readNotifications(
			through: string,
			signal?: AbortSignal
		): Promise<FluoNotificationSummary> {
			const { data, error, response } = await client.PUT('/v1/fluo/notifications/read', {
				body: { through },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async list(filter: FluoFeedFilter, cursor?: string, signal?: AbortSignal): Promise<FluoPage> {
			const query = filter.search?.toLocaleLowerCase().trim();
			const items: FluoPost[] = [];
			let nextCursor = cursor;
			let pagesScanned = 0;
			do {
				signal?.throwIfAborted();
				const { data, error, response } = await client.GET('/v1/fluo/posts', {
					params: {
						query: { feed: filter.feed, cursor: nextCursor, limit: 20, authorId: filter.authorId }
					},
					signal
				});
				const page = requireResponseData(data, error, response.status);
				pagesScanned++;
				for (const wire of page.items) {
					const preview = await content.post(wire, signal, !!query);
					if (
						!query ||
						[preview.text, preview.author.username, preview.author.displayName].some((value) =>
							value.toLocaleLowerCase().includes(query)
						)
					)
						items.push(query ? await content.post(wire, signal) : preview);
				}
				nextCursor = page.nextCursor ?? undefined;
				// A rare or missing term must not download the entire encrypted feed in one request.
			} while (query && nextCursor && items.length < 20 && pagesScanned < 3);
			return { items, nextCursor: nextCursor ?? null };
		},
		async comments(id: string, cursor?: string, signal?: AbortSignal): Promise<FluoPage> {
			const { data, error, response } = await client.GET('/v1/fluo/posts/{id}/comments', {
				params: { path: { id }, query: { cursor } },
				signal
			});
			const result = requireResponseData(data, error, response.status);
			return {
				...result,
				items: await Promise.all(result.items.map((item) => content.post(item, signal)))
			};
		},
		async get(id: string, signal?: AbortSignal): Promise<FluoPost> {
			const { data, error, response } = await client.GET('/v1/fluo/posts/{id}', {
				params: { path: { id } },
				signal
			});
			return content.post(requireResponseData(data, error, response.status), signal);
		},
		async thread(id: string, signal?: AbortSignal): Promise<FluoPostThread> {
			const { data, error, response } = await client.GET('/v1/fluo/posts/{id}/thread', {
				params: { path: { id } },
				signal
			});
			const result = requireResponseData(data, error, response.status);
			return {
				...result,
				posts: await Promise.all(result.posts.map((item) => content.post(item, signal)))
			};
		},
		async create(input: FluoNewPost): Promise<FluoPost> {
			const id = crypto.randomUUID();
			let result = await client.POST('/v1/fluo/posts', { body: await content.encode(input, id) });
			// Another device may have changed privacy; refresh the audience key and encrypt again once.
			if (result.response.status === 409) {
				await keys.refresh();
				result = await client.POST('/v1/fluo/posts', { body: await content.encode(input, id) });
			}
			return content.post(requireResponseData(result.data, result.error, result.response.status));
		},
		async setVisibility(
			id: string,
			visibility: FluoPost['visibility'],
			signal?: AbortSignal
		): Promise<void> {
			let body: {
				visibility: FluoPost['visibility'];
				content?: Awaited<ReturnType<typeof content.encode>>['content'];
			} = { visibility };
			// Hiding changes access only; publishing a self-only post encrypts it for the current audience.
			if (visibility === 'public') {
				const previous = await content.post(await wirePost(id, signal), signal);
				const encoded = await content.encode(
					{
						content: previous.content,
						visibility,
						...(previous.parentId ? { parentId: previous.parentId } : {}),
						...(previous.quoteId ? { quoteId: previous.quoteId } : {}),
						attachmentIds: previous.media.map((item) => item.id),
						altTexts: Object.fromEntries(previous.media.map((item) => [item.id, item.altText]))
					},
					id
				);
				body = { visibility, content: encoded.content };
			}
			const { error, response } = await client.PATCH('/v1/fluo/posts/{id}', {
				params: { path: { id } },
				body,
				signal
			});
			requireResponseOk(response, error);
		},
		async remove(id: string): Promise<void> {
			const { error, response } = await client.DELETE('/v1/fluo/posts/{id}', {
				params: { path: { id } }
			});
			requireResponseOk(response, error);
		},
		async setSaved(id: string, saved: boolean, signal?: AbortSignal): Promise<void> {
			const result = saved
				? await client.PUT('/v1/fluo/posts/{id}/saved', { params: { path: { id } }, signal })
				: await client.DELETE('/v1/fluo/posts/{id}/saved', { params: { path: { id } }, signal });
			requireResponseOk(result.response, result.error);
		},
		async react(
			id: string,
			value: FluoPost['myReaction'],
			signal?: AbortSignal
		): Promise<FluoPost> {
			const result = value
				? await client.PUT('/v1/fluo/posts/{id}/reaction', {
						params: { path: { id } },
						body: { value },
						signal
					})
				: await client.DELETE('/v1/fluo/posts/{id}/reaction', { params: { path: { id } }, signal });
			return content.post(
				requireResponseData(result.data, result.error, result.response.status),
				signal
			);
		},
		async follow(id: string, following: boolean, signal?: AbortSignal): Promise<void> {
			const result = following
				? await client.PUT('/v1/fluo/users/{id}/follow', { params: { path: { id } }, signal })
				: await client.DELETE('/v1/fluo/users/{id}/follow', { params: { path: { id } }, signal });
			requireResponseOk(result.response, result.error);
			// A private author shares audience keys with newly followed accounts immediately.
			if (following)
				await keys.refresh().catch(() => {
					// The active post operation reports key errors; background synchronization is best effort
				});
		},
		async uploadMetadata(id: string, signal?: AbortSignal): Promise<NodoUpload | null> {
			const { data, error, response } = await nodoClient.GET('/v1/uploads/{id}/meta', {
				params: { path: { id } },
				signal
			});
			if (response.status === 202) return null;
			return requireResponseData(data, error, response.status);
		}
	};
}

export type FluoApi = ReturnType<typeof createFluoApi>;

export const fluoSettingsKey = ['fluo', 'settings'] as const;

export function fluoSettingsOptions(api: Pick<FluoApi, 'settings'>) {
	return {
		queryKey: fluoSettingsKey,
		queryFn: ({ signal }: { signal: AbortSignal }) => api.settings(signal),
		staleTime: 30_000
	};
}

export function feedOptions(api: Pick<FluoApi, 'list'>, filter: FluoFeedFilter) {
	const baseKey = ['fluo', 'feed', filter.feed, filter.search ?? ''] as const;
	return {
		queryKey: filter.authorId ? ([...baseKey, filter.authorId] as const) : baseKey,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
			api.list(filter, pageParam, signal),
		getNextPageParam: (lastPage: FluoPage) => lastPage.nextCursor ?? undefined,
		staleTime: 15_000,
		refetchInterval: 5 * 60_000,
		refetchOnWindowFocus: true
	};
}

export function commentsOptions(api: Pick<FluoApi, 'comments'>, postId: string) {
	return {
		queryKey: ['fluo', 'comments', postId] as const,
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
			api.comments(postId, pageParam, signal),
		getNextPageParam: (lastPage: FluoPage) => lastPage.nextCursor ?? undefined,
		staleTime: 15_000,
		refetchInterval: 5 * 60_000
	};
}
