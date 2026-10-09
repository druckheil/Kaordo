<script lang="ts">
	// Composes a profile's view and editing modes with privacy-filtered posts and follow lists

	import { untrack, type Snippet } from 'svelte';
	import type { QueryClient } from '@tanstack/svelte-query';
	import type { FluoApi } from '@kaordo/api-client';
	import type { FluoProfile } from '@kaordo/contracts';
	import {
		Button,
		PencilIcon,
		CalendarDaysIcon,
		CakeIcon,
		MapPinIcon,
		GlobeIcon,
		ShieldCheckIcon,
		UserPlusIcon,
		CheckIcon
	} from '@kaordo/ui';
	import { UserAvatar } from '@kaordo/account-ui';
	import { mountPhotoSwipe } from '@kaordo/media-ui';
	import VerifiedBadge from './VerifiedBadge.svelte';
	import ProfilePresence from './ProfilePresence.svelte';
	import ProfileEditor from './ProfileEditor.svelte';
	import FluoConnectionsDialog from './FluoConnectionsDialog.svelte';
	import { createFluoProfileState } from './profile-state.svelte.ts';

	let {
		username,
		viewerId,
		api,
		queryClient,
		posts
	}: {
		username: string;
		viewerId: string;
		api: FluoApi;
		queryClient: QueryClient;
		posts: Snippet<[FluoProfile]>;
	} = $props();
	const profileState = createFluoProfileState(
		untrack(() => api),
		untrack(() => queryClient),
		() => username
	);
	const profile = $derived(profileState.query.data);
	const own = $derived(profile?.id === viewerId);
	let editing = $state(false);
	let saved = $state(false);
	let connections = $state<'followers' | 'following' | null>(null);
	let gallery = $state<HTMLDivElement>();
	$effect(() => mountPhotoSwipe(gallery));

	function formatDate(value: string, birthday = false) {
		return new Intl.DateTimeFormat(
			'en',
			birthday ? { dateStyle: 'long', timeZone: 'UTC' } : { month: 'long', year: 'numeric' }
		).format(new Date(birthday ? `${value}T12:00:00Z` : value));
	}
	function websiteLabel(value: string) {
		return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
	}
</script>

{#if profile}
	{#if editing && own}
		<ProfileEditor
			{profile}
			{api}
			{queryClient}
			onCancel={() => (editing = false)}
			onSaved={() => {
				editing = false;
				saved = true;
			}}
		/>
	{:else}
		<div
			bind:this={gallery}
			class="mb-6 overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm"
		>
			<div class="relative aspect-[3/1] bg-gradient-to-br from-primary/15 via-accent to-muted">
				{#if profile.banner}
					<a
						href={profile.banner.url}
						data-pswp-item
						data-pswp-width={profile.banner.width}
						data-pswp-height={profile.banner.height}
						aria-label={`View ${profile.displayName}'s banner`}
						class="absolute inset-0 block focus-visible:outline-3 focus-visible:-outline-offset-4 focus-visible:outline-ring"
					>
						<img
							src={profile.banner.url}
							alt={`Profile banner for ${profile.displayName}`}
							width={profile.banner.width}
							height={profile.banner.height}
							decoding="async"
							class="h-full w-full object-cover"
						/>
					</a>
				{/if}
			</div>
			<div class="px-5 pb-5 sm:px-6 sm:pb-6">
				<div class="relative -mt-10 mb-3 flex items-end justify-between gap-3">
					<div class="rounded-3xl border-4 border-card bg-card">
						{#if profile.avatar}
							<a
								href={profile.avatar.url}
								data-pswp-item
								data-pswp-width={profile.avatar.width}
								data-pswp-height={profile.avatar.height}
								aria-label={`View ${profile.displayName}'s avatar`}
								class="block rounded-[1.25rem] focus-visible:outline-3 focus-visible:outline-ring"
							>
								<UserAvatar
									user={profile}
									image={profile.avatar}
									class="size-24 rounded-[1.25rem] [&_[data-slot=avatar-fallback]]:text-3xl"
								/>
							</a>
						{:else}
							<UserAvatar
								user={profile}
								image={null}
								class="size-24 rounded-[1.25rem] [&_[data-slot=avatar-fallback]]:text-3xl"
							/>
						{/if}
					</div>
					<div class="pb-1">
						{#if own}
							<Button
								variant="outline"
								size="sm"
								class="rounded-full"
								onclick={() => {
									editing = true;
									saved = false;
								}}><PencilIcon class="size-4" />Edit profile</Button
							>
						{:else}
							<Button
								variant={profile.following ? 'outline' : 'default'}
								size="sm"
								class="min-w-28 rounded-full"
								disabled={profileState.follow.isPending}
								onclick={() => profileState.follow.mutate(profile)}
								aria-pressed={profile.following}
							>
								{#if profile.following}<CheckIcon class="size-4" />{:else}<UserPlusIcon
										class="size-4"
									/>{/if}
								{profileState.follow.isPending
									? 'Saving…'
									: profile.following
										? 'Following'
										: 'Follow'}
							</Button>
						{/if}
					</div>
				</div>
				<div class="flex flex-wrap items-start justify-between gap-2">
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<h1 class="min-w-0 text-2xl font-bold tracking-tight break-words">
								{profile.displayName}
							</h1>
							{#if profile.verified}<VerifiedBadge />{/if}
						</div>
						<div
							class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
						>
							<span class="break-all">@{profile.username}</span>
							{#if profile.pronouns}<span
									class="max-w-full rounded-full bg-muted px-2 py-0.5 text-xs break-words"
									>{profile.pronouns}</span
								>{/if}
							{#if !own && profile.followedBy}<span
									class="rounded-full border border-border px-2 py-0.5 text-xs">Follows you</span
								>{/if}
						</div>
					</div>
					{#if own && profile.status}
						<ProfilePresence
							status={profile.status}
							busy={profileState.setStatus.isPending}
							onChange={(status) => profileState.setStatus.mutate(status)}
						/>
					{/if}
				</div>
				{#if profile.bio}<p
						class="mt-4 text-sm leading-6 break-words whitespace-pre-wrap text-foreground/90"
					>
						{profile.bio}
					</p>{/if}
				<div
					class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs leading-5 text-muted-foreground"
				>
					{#if profile.location}<span class="inline-flex max-w-full min-w-0 items-center gap-1.5"
							><MapPinIcon class="size-3.5 shrink-0" /><span class="min-w-0 break-words"
								>{profile.location}</span
							></span
						>{/if}
					{#if profile.website}<a
							href={profile.website}
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded text-link hover:underline focus-visible:outline-2 focus-visible:outline-ring"
							><GlobeIcon class="size-3.5 shrink-0" /><span class="truncate"
								>{websiteLabel(profile.website)}</span
							><span class="sr-only"> (opens in a new tab)</span></a
						>{/if}
					{#if profile.birthDate}<span class="inline-flex items-center gap-1.5"
							><CakeIcon class="size-3.5 shrink-0" />Born {formatDate(
								profile.birthDate,
								true
							)}</span
						>{/if}
					<span class="inline-flex items-center gap-1.5"
						><CalendarDaysIcon class="size-3.5 shrink-0" />Joined
						<time datetime={profile.createdAt}>{formatDate(profile.createdAt)}</time></span
					>
				</div>
				<div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1">
					{#each [{ kind: 'following', count: profile.followingCount, label: 'Following' }, { kind: 'followers', count: profile.followersCount, label: 'Followers' }] as const as relation (relation.kind)}
						<button
							type="button"
							class="inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm transition-colors hover:text-link focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
							onclick={() => (connections = relation.kind)}
						>
							<span class="font-semibold tabular-nums">{relation.count.toLocaleString('en')}</span
							><span class="text-muted-foreground">{relation.label}</span>
						</button>
					{/each}
					{#if profile.accountVisibility === 'private'}<span
							class="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground"
							><ShieldCheckIcon class="size-3.5" />Private account</span
						>{/if}
				</div>
				{#if saved}<p class="mt-2 inline-flex items-center gap-1.5 text-xs text-link" role="status">
						<CheckIcon class="size-3.5" />Profile updated.
					</p>{/if}
				{#if own && profileState.setStatus.isError}<p
						class="mt-3 text-sm text-destructive"
						role="alert"
					>
						{profileState.setStatus.error.message}
					</p>{/if}
				{#if profileState.follow.isError}<p class="mt-3 text-sm text-destructive" role="alert">
						{profileState.follow.error.message}
					</p>{/if}
			</div>
		</div>
		{#if profile.canViewPosts}
			<h2 class="mb-4 px-1 text-sm font-semibold">Posts</h2>
			{@render posts(profile)}
		{:else}
			<div class="rounded-[1.5rem] border border-dashed border-border bg-card p-8 text-center">
				<ShieldCheckIcon class="mx-auto size-8 text-muted-foreground" />
				<h2 class="mt-3 font-semibold">This account is private</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					Posts are shared only with people this account follows.
				</p>
			</div>
		{/if}
	{/if}
	{#if connections}<FluoConnectionsDialog
			profileId={profile.id}
			kind={connections}
			{api}
			{queryClient}
			onClose={() => (connections = null)}
		/>{/if}
{:else if profileState.query.isError}
	<div class="rounded-[1.5rem] border border-border bg-card p-8 text-center">
		<p class="text-sm text-destructive" role="alert">{profileState.query.error.message}</p>
		<Button class="mt-4" variant="outline" onclick={() => void profileState.query.refetch()}
			>Try again</Button
		>
	</div>
{:else}
	<div
		class="overflow-hidden rounded-[1.5rem] border border-border bg-card"
		role="status"
		aria-label="Loading profile"
	>
		<div class="aspect-[3/1] animate-pulse bg-muted" aria-hidden="true"></div>
		<div class="p-6">
			<div class="mb-4 h-6 w-40 animate-pulse rounded-lg bg-muted" aria-hidden="true"></div>
			<span class="text-sm text-muted-foreground">Loading profile…</span>
		</div>
	</div>
{/if}
