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
		MessageCircleIcon,
		Trash2Icon,
	} from '@kaordo/ui';
	import { MediaGallery } from '@kaordo/media-ui';
	import PostActions from './PostActions.svelte';
	import QuotePreview from './QuotePreview.svelte';
	import RichText from './RichText.svelte';
	import { postHashForId } from './fluo-model';

	let {
		post,
		viewerId,
		compact = false,
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
		showReplyAction?: boolean;
		children?: Snippet;
		onReply: (post: FluoPost) => void;
		onQuote: (post: FluoPost) => void;
		onOpenPost: (id: string) => void;
		onReact: (post: FluoPost, value: 'good' | 'bad' | null) => Promise<void>;
		onFollow: (post: FluoPost) => Promise<void>;
		onSave: (post: FluoPost) => Promise<void>;
		onVisibilityChange: (post: FluoPost, visibility: FluoPost['visibility']) => Promise<void>;
		onDelete: (post: FluoPost) => void;
	} = $props();

	let following = $state(false);
	let visibilityChanging = $state(false);
	const date = $derived(formatPostTime(post.createdAt));
	const initials = $derived(authorInitials(post.author.displayName, post.author.username));

	function formatPostTime(value: string): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
	}

	function authorInitials(displayName: string, username: string): string {
		const initials = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase();
		return initials || username[0]?.toLocaleUpperCase() || 'K';
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
			class="fluo-post group/post-card relative isolate min-w-0 rounded-[1.5rem] border border-border bg-card p-[var(--media-gallery-edge-gutter)] shadow-[0_10px_32px_-25px_rgba(20,65,39,.5)]"
			class:fluo-reply={compact}
			aria-label={'Post by ' + post.author.username}
		>
			<a
				href={postHashForId(post.id)}
				class="absolute inset-0 z-0 cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
				aria-label={`Open post by @${post.author.username}`}
				onclick={openPostFromCard}
			></a>
			{#if post.parentId && !compact}
				<Button
					class="relative z-10 -mb-2 w-fit justify-start text-muted-foreground"
					variant="ghost"
					size="xs"
					onclick={() => onOpenPost(post.parentId!)}
				>
					<MessageCircleIcon class="size-3.5" />View parent post
				</Button>
			{/if}

			<header class="flex items-start gap-3">
				<div class="relative z-10 grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-sm font-bold text-accent-foreground" aria-hidden="true">{initials}</div>
				<div class="min-w-0 flex-1">
					<div class="flex flex-wrap items-baseline gap-x-2">
						<span class="relative z-10 truncate text-sm font-bold text-foreground">{post.author.displayName}</span>
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
								value={post.visibility}
								onValueChange={(value) => void changeVisibility(value)}
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
				value={post.visibility}
				onValueChange={(value) => void changeVisibility(value)}
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
	.post-card-carousel-media :global([data-slot="button"]) {
		position: relative;
		z-index: 10;
	}

	@media (hover: none) {
		:global(.post-menu-trigger) { opacity: 1; pointer-events: auto; }
	}

	@media (min-width: 40rem) {
		.fluo-post { --media-gallery-edge-gutter: 1.5rem; }
	}
</style>
