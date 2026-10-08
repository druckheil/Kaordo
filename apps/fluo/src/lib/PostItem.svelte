<script lang="ts">
	// Renders one interactive Fluo post with an optional nested content slot

	import type { Snippet } from 'svelte';
	import type { FluoPost } from '@kaordo/contracts';
	import {
		ArrowRightIcon,
		Button,
		ContextMenu,
		DropdownMenu,
		EllipsisIcon,
		Trash2Icon,
	} from '@kaordo/ui';
	import { MediaGallery } from '@kaordo/media-ui';
	import PostActions from './PostActions.svelte';
	import QuotePreview from './QuotePreview.svelte';
	import RichText from './RichText.svelte';
	import { postHashForId } from './fluo-model';
	import type { FluoPostActionHandlers } from './post-actions';
	import { UserAvatar } from '@kaordo/account-ui';
	import ProfileLink from './ProfileLink.svelte';
	import VerifiedBadge from './VerifiedBadge.svelte';

	let {
		post,
		viewerId,
		compact = false,
		focusTarget = false,
		threadContext,
		showReplyAction = true,
		children,
		onReply,
		onQuote,
		onOpenPost,
		onReact,
		onFollow,
		onSave,
		onVisibilityChange,
		onDelete,
	}: {
		post: FluoPost;
		viewerId: string;
		compact?: boolean;
		focusTarget?: boolean;
		threadContext?: Snippet;
		showReplyAction?: boolean;
		children?: Snippet;
		onReply: (post: FluoPost) => void;
		onQuote: (post: FluoPost) => void;
		onOpenPost: (id: string) => void;
		onReact: FluoPostActionHandlers['react'];
		onFollow: FluoPostActionHandlers['follow'];
		onSave: FluoPostActionHandlers['save'];
		onVisibilityChange: FluoPostActionHandlers['setVisibility'];
		onDelete: (post: FluoPost) => void;
	} = $props();

	let following = $state(false);
	let visibilityChanging = $state(false);
	const date = $derived(formatPostTime(post.createdAt));

	function formatPostTime(value: string): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
	}

	async function toggleFollow(): Promise<void> {
		if (following) return;
		following = true;
		try {
			await onFollow(post);
		} finally {
			following = false;
		}
	}

	function openPostFromCard(event: MouseEvent): void {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

		event.preventDefault();
		onOpenPost(post.id);
	}

	// Function bindings keep both menus tied to confirmed server visibility
	async function changeVisibility(value: string): Promise<void> {
		if (visibilityChanging || (value !== 'public' && value !== 'private') || value === post.visibility) return;

		visibilityChanging = true;
		try {
			await onVisibilityChange(post, value);
		} finally {
			visibilityChanging = false;
		}
	}
</script>

<ContextMenu.Root>
	<ContextMenu.Trigger
		class="block w-full rounded-[1.5rem] select-text"
		aria-label={`Post by @${post.author.username}`}
		oncontextmenu={(event) => event.stopPropagation()}
	>
		<article
			data-post-id={post.id}
			class="fluo-post group/post-card relative isolate min-w-0 rounded-[1.5rem] border border-border bg-card px-[var(--media-gallery-edge-gutter)] pt-[var(--media-gallery-edge-gutter)] pb-1.5 sm:pb-2 shadow-[0_10px_32px_-25px_rgba(20,65,39,.5)]"
			class:fluo-reply={compact}
			aria-label={'Post by ' + post.author.username}
		>
			<a
				href={postHashForId(post.id)}
				class="absolute inset-0 z-0 cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
				aria-label={`Open post by @${post.author.username}`}
				onclick={openPostFromCard}
			></a>
			{@render threadContext?.()}
			<header
				id={focusTarget ? `fluo-focused-post-${post.id}` : undefined}
				class="flex scroll-mt-20 items-start gap-3"
			>
				<ProfileLink username={post.author.username} label={`Open profile of @${post.author.username}`} class="relative z-10 shrink-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-ring"><UserAvatar user={post.author} /></ProfileLink>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-baseline gap-x-2">
						<ProfileLink username={post.author.username} class="relative z-10 inline-flex min-w-0 items-center gap-1.5 rounded text-sm font-bold text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"><span class="truncate">{post.author.displayName}</span>{#if post.author.verified}<VerifiedBadge />{/if}</ProfileLink>
						<span class="relative z-10 truncate text-xs text-muted-foreground">@{post.author.username}</span>
					</div>
					<p class="mt-0.5 text-xs text-muted-foreground">
						<time class="relative z-10" datetime={post.createdAt}>{date}</time>
						{#if post.visibility === 'private'}<span class="relative z-10 ml-1.5 rounded-full bg-muted px-2 py-0.5 font-medium">Only me</span>{/if}
					</p>
				</div>
				{#if post.author.id !== viewerId && post.visibility === 'public'}
					<Button
						variant={post.author.following ? 'secondary' : 'outline'}
						size="sm"
						disabled={following}
						class="relative z-10"
						aria-pressed={post.author.following}
						onclick={toggleFollow}
					>
						{post.author.following ? 'Following' : 'Follow'}
					</Button>
				{:else if post.author.id === viewerId}
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							aria-label="Post actions"
							class="post-menu-trigger relative z-10 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:pointer-events-none sm:opacity-0 sm:group-hover/post-card:pointer-events-auto sm:group-hover/post-card:opacity-100 sm:group-focus-within/post-card:pointer-events-auto sm:group-focus-within/post-card:opacity-100"
						>
							<EllipsisIcon class="size-4" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Label>Post</DropdownMenu.Label>
							<DropdownMenu.Item onSelect={() => onOpenPost(post.id)}>
								<ArrowRightIcon class="size-4" />Open post
							</DropdownMenu.Item>
							<DropdownMenu.Separator />
							<DropdownMenu.Label>Change visibility</DropdownMenu.Label>
							<DropdownMenu.RadioGroup
								bind:value={() => post.visibility, (value) => void changeVisibility(value)}
							>
								<DropdownMenu.RadioItem value="public" disabled={visibilityChanging}>
									Public
								</DropdownMenu.RadioItem>
								<DropdownMenu.RadioItem value="private" disabled={visibilityChanging}>
									Only me
								</DropdownMenu.RadioItem>
							</DropdownMenu.RadioGroup>
							<DropdownMenu.Separator />
							<DropdownMenu.Item variant="destructive" onSelect={() => onDelete(post)}>
								<Trash2Icon class="size-4" />Delete post
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				{/if}
			</header>

			{#if post.text.trim()}
				<div class={`relative z-10 mt-4 w-fit max-w-full ${compact ? 'ml-1 sm:ml-3' : ''}`}>
					<RichText content={post.content} />
				</div>
			{/if}
			<div
				class:post-card-single-media={post.media.length === 1}
				class:post-card-carousel-media={post.media.length > 2}
				class:relative={post.media.length === 2}
				class:z-10={post.media.length === 2}
			>
				<MediaGallery media={post.media} edgeBleed showPositionLabel={post.media.length <= 2} />
			</div>
			{#if post.quote}
				<div class="relative z-10"><QuotePreview quote={post.quote} onOpen={onOpenPost} /></div>
			{:else if post.quoteDeleted || post.quoteId}
				<p class="relative z-10 mt-4 rounded-2xl border p-4 text-sm text-muted-foreground">
					{post.quoteDeleted ? 'Quoted post was deleted.' : 'Quoted post unavailable.'}
				</p>
			{/if}

			<PostActions
				{post}
				onReply={() => onReply(post)}
				onQuote={() => onQuote(post)}
				onReact={(value) => onReact(post, value)}
				onSave={() => onSave(post)}
				{showReplyAction}
			/>

			{@render children?.()}
		</article>
	</ContextMenu.Trigger>

	<ContextMenu.Content>
		<ContextMenu.Label>Post</ContextMenu.Label>
		<ContextMenu.Item onSelect={() => onOpenPost(post.id)}>
			<ArrowRightIcon class="size-4" />Open post
		</ContextMenu.Item>
		{#if post.author.id === viewerId}
			<ContextMenu.Separator />
			<ContextMenu.Label>Change visibility</ContextMenu.Label>
			<ContextMenu.RadioGroup
				bind:value={() => post.visibility, (value) => void changeVisibility(value)}
			>
				<ContextMenu.RadioItem value="public" disabled={visibilityChanging}>
					Public
				</ContextMenu.RadioItem>
				<ContextMenu.RadioItem value="private" disabled={visibilityChanging}>
					Only me
				</ContextMenu.RadioItem>
			</ContextMenu.RadioGroup>
			<ContextMenu.Separator />
			<ContextMenu.Item variant="destructive" onSelect={() => onDelete(post)}>
				<Trash2Icon class="size-4" />Delete post
			</ContextMenu.Item>
		{/if}
	</ContextMenu.Content>
</ContextMenu.Root>

<style>
	.fluo-post {
		--media-gallery-edge-gutter: 1rem;
		transition: border-color .2s ease, box-shadow .2s ease;
	}
	.fluo-post:hover { border-color: var(--input); box-shadow: 0 16px 40px -30px rgba(20, 65, 39, .55); }
	.fluo-post.fluo-reply {
		--media-gallery-edge-gutter: .75rem;
		border-radius: 1rem;
		box-shadow: none;
	}
	.fluo-post.fluo-reply:hover { box-shadow: none; }

	.post-card-single-media :global([data-pswp-item]),
	.post-card-single-media :global(media-player) {
		position: relative;
		z-index: 10;
	}

	.post-card-carousel-media {
		pointer-events: none;
	}

	.post-card-carousel-media :global([aria-roledescription="slide"]),
	.post-card-carousel-media :global([data-slot="button"]),
	.post-card-carousel-media :global([data-pswp-item]) {
		position: relative;
		z-index: 10;
		pointer-events: auto;
	}

	@media (hover: none) {
		:global(.post-menu-trigger) { opacity: 1; pointer-events: auto; }
	}

	@media (min-width: 40rem) {
		.fluo-post { --media-gallery-edge-gutter: 1.5rem; }
	}
</style>
