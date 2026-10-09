<script lang="ts">
	// Renders current Fluo activity, media previews and dismissible unread bookmarks

	import { fly } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import type { FluoNotification } from '@kaordo/contracts';
	import { fluoNotificationItems } from '@kaordo/api-client';
	import { MediaPreview } from '@kaordo/media-ui';
	import {
		BellIcon,
		Button,
		CheckIcon,
		HeartIcon,
		MessageCircleIcon,
		Repeat2Icon,
		XIcon,
		UserMinusIcon,
		UserPlusIcon
	} from '@kaordo/ui';
	import { postHashForId, profileHashForUsername } from './fluo-model';
	import { UserAvatar } from '@kaordo/account-ui';
	import VerifiedBadge from './VerifiedBadge.svelte';
	import type { FluoNotificationState } from './notification-state.svelte.ts';

	let {
		state,
		onOpenPost,
		onOpenProfile
	}: {
		state: FluoNotificationState;
		onOpenPost: (id: string) => void;
		onOpenProfile: (username: string) => void;
	} = $props();

	const query = $derived(state.history);
	const recent = $derived(state.recent);
	const unreadCount = $derived(state.unreadCount);
	const reading = $derived(state.read.isPending);
	const readingAll = $derived(
		reading && state.read.variables !== undefined && 'through' in state.read.variables
	);
	const notifications = $derived(fluoNotificationItems(recent.data, query.data?.pages));
	const firstPage = $derived(recent.data ?? query.data?.pages[0]);
	const through = $derived(firstPage?.through ?? null);
	const error = $derived(recent.error ?? query.error);
	const loading = $derived(recent.isPending && query.isPending);
	const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
	const activity = {
		like: { description: 'liked your post.', icon: HeartIcon },
		dislike: { description: 'disliked your post.', icon: XIcon },
		reply: { description: 'replied to your post.', icon: MessageCircleIcon },
		quote: { description: 'quoted your post.', icon: Repeat2Icon },
		follow: { description: 'started following you.', icon: UserPlusIcon },
		unfollow: { description: 'stopped following you.', icon: UserMinusIcon }
	} as const;

	function openNotification(event: MouseEvent, notification: FluoNotification): void {
		if (!notification.readAt) state.read.mutate({ id: notification.id });
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			return;
		event.preventDefault();
		if (notification.post) onOpenPost(notification.post.id);
		else onOpenProfile(notification.actor.username);
	}

	function readBookmark(event: MouseEvent, notification: FluoNotification): void {
		const target = event.currentTarget as HTMLButtonElement;
		if (target.matches(':focus-visible')) {
			target
				.closest('li')
				?.querySelector<HTMLElement>('[data-notification-entry]')
				?.focus({ preventScroll: true });
		}
		state.read.mutate({ id: notification.id });
	}
</script>

<div class="mb-4 grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
	<p
		class="min-h-9 content-center truncate text-sm text-muted-foreground"
		class:invisible={!firstPage}
		role="status"
	>
		{unreadCount === 0
			? 'You are all caught up.'
			: `${unreadCount.toLocaleString('en')} unread ${unreadCount === 1 ? 'notification' : 'notifications'}`}
	</p>
	<div class="flex min-h-9 items-center sm:justify-end">
		{#if unreadCount > 0}
			<Button
				variant="outline"
				size="sm"
				disabled={!through || reading}
				onclick={() => through && state.read.mutate({ through })}
			>
				<CheckIcon class="size-4" />{readingAll ? 'Marking as read…' : 'Mark all as read'}
			</Button>
		{/if}
	</div>
</div>

{#if error}
	<div class="mb-4 rounded-xl border border-destructive/35 bg-card p-4">
		<p class="text-sm text-destructive" role="alert">{error.message}</p>
		<Button
			class="mt-3"
			variant="outline"
			size="sm"
			onclick={() => void Promise.all([recent.refetch(), query.refetch()])}>Try again</Button
		>
	</div>
{/if}

{#if loading}
	<p
		class="rounded-[1.5rem] border border-border bg-card px-6 py-14 text-center text-sm text-muted-foreground"
		role="status"
	>
		Loading notifications…
	</p>
{:else if !error && notifications.length === 0}
	<div class="rounded-[1.5rem] border border-border bg-card px-6 py-16 text-center shadow-sm">
		<div class="mx-auto grid size-14 place-items-center rounded-2xl bg-accent" aria-hidden="true">
			<BellIcon class="size-6 text-accent-foreground" />
		</div>
		<p class="mt-5 text-xl font-bold tracking-tight">No notifications yet</p>
		<p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
			Reactions, replies, quotes and new followers will appear here.
		</p>
	</div>
{:else if notifications.length > 0}
	<ul
		class="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm"
		aria-label="Notifications"
	>
		{#each notifications as notification (notification.id)}
			<li
				class={`relative overflow-hidden border-b border-border transition-colors duration-300 last:border-b-0 ${notification.readAt ? '' : 'bg-muted/35'}`}
			>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- Notification hashes stay on the current route -->
				<a
					href={notification.post
						? postHashForId(notification.post.id)
						: profileHashForUsername(notification.actor.username)}
					data-notification-entry
					class={`flex min-w-0 gap-3 p-4 transition-[background-color,padding] duration-300 hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:p-5 ${notification.readAt ? '' : 'pr-16 sm:pr-18'}`}
					onclick={(event) => openNotification(event, notification)}
					onauxclick={(event) => {
						if (notification.post && event.button === 1 && !notification.readAt)
							state.read.mutate({ id: notification.id });
					}}
				>
					{@render content(notification)}
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{#if !notification.readAt}
					<div
						class="absolute inset-y-0 right-0 w-11 sm:w-12"
						out:fly={{
							x: prefersReducedMotion.current ? 0 : 48,
							duration: prefersReducedMotion.current ? 0 : 260
						}}
					>
						<Button
							variant="ghost"
							class="absolute inset-0 h-full w-full rounded-none border-0 p-0 hover:bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-3 focus-visible:outline-ring focus-visible:ring-inset active:not-aria-[haspopup]:translate-y-0"
							disabled={reading}
							aria-label={`Mark as read: ${notification.actor.displayName} ${activity[notification.kind].description}`}
							title="Mark as read"
							onclick={(event: MouseEvent) => readBookmark(event, notification)}
						>
							<span
								class="notification-bookmark pointer-events-none absolute inset-0 border-l border-primary/20 bg-primary/15 transition-colors group-hover/button:bg-primary/25"
								aria-hidden="true"
							></span>
						</Button>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
	{#if firstPage?.nextCursor && query.hasNextPage}
		<Button
			class="mt-4 w-full"
			variant="outline"
			disabled={query.isFetching}
			onclick={() => void query.fetchNextPage()}
		>
			{query.isFetchingNextPage
				? 'Loading more…'
				: query.isFetchNextPageError
					? 'Try loading more'
					: 'Load more notifications'}
		</Button>
	{/if}
{/if}

{#snippet content(notification: FluoNotification)}
	{@const Icon = activity[notification.kind].icon}
	<span class="relative size-10 shrink-0 self-start">
		<UserAvatar user={notification.actor} class="size-10 rounded-xl" />
		<span
			class="absolute -bottom-1 -left-1 grid size-5 place-items-center rounded-full border border-border bg-card text-foreground"
			aria-hidden="true"><Icon class="size-3" /></span
		>
	</span>
	<span class="block min-w-0 flex-1 break-words">
		<span class="block text-sm leading-6">
			<strong class="inline-flex max-w-full items-center gap-1 font-semibold"
				>{notification.actor.displayName}{#if notification.actor.verified}<VerifiedBadge
					/>{/if}</strong
			>
			{activity[notification.kind].description}
			{#if !notification.readAt}<span class="sr-only">Unread.</span>{/if}
		</span>
		<span class="block truncate text-xs text-muted-foreground">@{notification.actor.username}</span>
		{#if notification.post?.text}
			<span
				class="mt-2 line-clamp-2 border-l-2 border-border pl-3 text-sm leading-6 break-words text-muted-foreground"
				>{notification.post.text}</span
			>
		{/if}
		{#if notification.post?.media.length}
			<MediaPreview media={notification.post.media} />
		{/if}
		<time class="mt-2 block text-xs text-muted-foreground" datetime={notification.createdAt}
			>{dateFormat.format(new Date(notification.createdAt))}</time
		>
	</span>
{/snippet}

<style>
	.notification-bookmark {
		clip-path: polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - 12px), 0 100%);
	}
</style>
