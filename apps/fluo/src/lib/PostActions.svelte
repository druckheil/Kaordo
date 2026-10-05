<script lang="ts">
	// Renders the available reactions and post actions

	import type { FluoPost } from "@kaordo/contracts";
	import {
		BookmarkIcon,
		Button,
		MessageCircleIcon,
		Repeat2Icon,
		ThumbsDownIcon,
		ThumbsUpIcon,
	} from "@kaordo/ui";

	let { post, onReply, onQuote, onReact, onSave, showReplyAction = true }: {
		post: FluoPost;
		onReply: () => void;
		onQuote: () => void;
		onReact: (value: "good" | "bad" | null) => Promise<void>;
		onSave: () => Promise<void>;
		showReplyAction?: boolean;
	} = $props();

	let saving = $state(false);
	let reacting = $state(false);
	const actionColumns = $derived((post.visibility === "public" ? 3 : 2) + (showReplyAction ? 1 : 0));

	async function chooseReaction(value: "good" | "bad"): Promise<void> {
		if (reacting) return;
		reacting = true;
		try {
			await onReact(post.myReaction === value ? null : value);
		} finally {
			reacting = false;
		}
	}

	async function toggleSaved(): Promise<void> {
		if (saving) return;
		saving = true;
		try {
			await onSave();
		} finally {
			saving = false;
		}
	}
</script>

<div
	class="post-actions mt-5 grid gap-1.5 border-t border-border/80 pt-3 sm:gap-3"
	style={`--post-action-columns: ${actionColumns}; --post-action-columns-touch: ${actionColumns + 1}`}
	aria-label="Post actions"
>
	<div class:disliked={post.myReaction === "bad"} class="reaction-control relative">
		<Button
			class="h-11 w-full min-w-0 gap-1 px-1 sm:gap-2 sm:px-3"
			variant={post.myReaction === "good" ? "secondary" : "ghost"}
			size="sm"
			aria-label={`Like, ${post.counts.good}`}
			aria-pressed={post.myReaction === "good"}
			aria-busy={reacting}
			disabled={reacting}
			onclick={() => void chooseReaction("good")}
		>
			<ThumbsUpIcon class="size-4" />
			<span class="hidden text-xs sm:inline">Like</span>
			<span class="text-xs tabular-nums">{post.counts.good}</span>
		</Button>
		<Button
			class="dislike-choice absolute -right-2 -top-10 z-10 rounded-full border border-border bg-card shadow-lg"
			variant={post.myReaction === "bad" ? "secondary" : "outline"}
			size="icon-sm"
			aria-label={`Dislike, ${post.counts.bad}`}
			aria-pressed={post.myReaction === "bad"}
			aria-busy={reacting}
			disabled={reacting}
			onclick={() => void chooseReaction("bad")}
		>
			<ThumbsDownIcon class={post.myReaction === "bad" ? "size-4 fill-current" : "size-4"} />
		</Button>
	</div>

	{#if showReplyAction}
		<Button class="h-11 min-w-0 gap-1 px-1 sm:gap-2 sm:px-3" variant="ghost" size="sm"
			aria-label="Reply to post" onclick={onReply}>
			<MessageCircleIcon class="size-4" />
			<span class="hidden text-xs sm:inline">Reply</span>
			<span class="text-xs tabular-nums">{post.counts.comments}</span>
		</Button>
	{/if}

	{#if post.visibility === "public"}
		<Button class="h-11 min-w-0 gap-1 px-1 sm:gap-2 sm:px-3" variant="ghost" size="sm"
			aria-label="Quote post" onclick={onQuote}>
			<Repeat2Icon class="size-4" /><span class="hidden text-xs sm:inline">Quote</span>
		</Button>
	{/if}

	<Button class="h-11 min-w-0 gap-1 px-1 sm:gap-2 sm:px-3" variant={post.saved ? "secondary" : "ghost"}
		size="sm" aria-label={post.saved ? "Remove from saved posts" : "Save post"}
		aria-pressed={post.saved} aria-busy={saving} disabled={saving} onclick={() => void toggleSaved()}>
		<BookmarkIcon class={post.saved ? "size-4 fill-current" : "size-4"} />
		<span class="hidden text-xs sm:inline">{saving ? "Saving…" : post.saved ? "Saved" : "Save"}</span>
	</Button>
</div>

<style>
	.post-actions {
		grid-template-columns: repeat(var(--post-action-columns), minmax(0, 1fr));
	}

	:global(.dislike-choice) {
		opacity: 0;
		pointer-events: none;
		transform: translateY(4px) scale(0.92);
		transition: opacity 0.18s ease, transform 0.18s ease;
	}

	.reaction-control:hover :global(.dislike-choice),
	.reaction-control:focus-within :global(.dislike-choice),
	.reaction-control.disliked :global(.dislike-choice) {
		opacity: 1;
		pointer-events: auto;
		transform: none;
	}

	@media (hover: none) {
		.post-actions { grid-template-columns: repeat(var(--post-action-columns-touch), minmax(0, 1fr)); gap: 0.25rem; }
		.reaction-control { display: contents; }
		:global(.dislike-choice) {
			position: static;
			width: 100%;
			height: 2.75rem;
			border-color: transparent;
			background: transparent;
			box-shadow: none;
			opacity: 1;
			pointer-events: auto;
			transform: none;
		}
		.reaction-control.disliked :global(.dislike-choice) { background: var(--secondary); }
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.dislike-choice) { transition: none; }
	}
</style>
