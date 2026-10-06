<script lang="ts">
	// Renders the available reactions and post actions

	import type { FluoPost } from "@kaordo/contracts";
	import {
		BookmarkIcon,
		Button,
		MessageCircleIcon,
		Repeat2Icon,
		Share2Icon,
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
	const actionButtonClass = "h-11 min-w-0 gap-1 px-1 sm:gap-2 sm:px-3";
	const fixedActionColumns = 3; // Like, save, and share
	const showQuoteAction = $derived(post.visibility === "public");
	const actionColumns = $derived(
		fixedActionColumns + (showQuoteAction ? 1 : 0) + (showReplyAction ? 1 : 0),
	);

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
	class="post-actions pointer-events-none relative z-10 mt-1 grid gap-1.5 sm:gap-3"
	style={`--post-action-columns: ${actionColumns}; --post-action-columns-touch: ${actionColumns + 1}`}
	aria-label="Post actions"
>
	{#if showReplyAction}
		<Button class={actionButtonClass} variant="ghost" size="sm"
			aria-label={`Reply, ${post.counts.comments}`} onclick={onReply}>
			<MessageCircleIcon class="size-5" />
			<span class="text-xs tabular-nums sm:text-sm">{post.counts.comments}</span>
		</Button>
	{/if}

	{#if showQuoteAction}
		<Button class={actionButtonClass} variant="ghost" size="sm"
			aria-label={`Quote, ${post.counts.quotes}`} onclick={onQuote}>
			<Repeat2Icon class="size-5" />
			<span class="text-xs tabular-nums sm:text-sm">{post.counts.quotes}</span>
		</Button>
	{/if}

	<div class:disliked={post.myReaction === "bad"} class="reaction-control relative">
		<Button
			class={`${actionButtonClass} w-full`}
			variant={post.myReaction === "good" ? "secondary" : "ghost"}
			size="sm"
			aria-label={`Like, ${post.counts.good}`}
			aria-pressed={post.myReaction === "good"}
			aria-busy={reacting}
			disabled={reacting}
			onclick={() => void chooseReaction("good")}
		>
			<ThumbsUpIcon class="size-5" />
			<span class="text-xs tabular-nums sm:text-sm">{post.counts.good}</span>
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
			<ThumbsDownIcon class={post.myReaction === "bad" ? "size-5 fill-current" : "size-5"} />
		</Button>
	</div>

	<Button class={actionButtonClass} variant={post.saved ? "secondary" : "ghost"}
		size="sm" aria-label={`${post.saved ? "Remove from saved posts" : "Save post"}, ${post.counts.saves}`}
		aria-pressed={post.saved} aria-busy={saving} disabled={saving} onclick={() => void toggleSaved()}>
		<BookmarkIcon class={post.saved ? "size-5 fill-current" : "size-5"} />
		<span class="text-xs tabular-nums sm:text-sm">{post.counts.saves}</span>
	</Button>

	<Button class={actionButtonClass} variant="ghost" size="sm"
		aria-label="Share post" disabled>
		<Share2Icon class="size-5" />
	</Button>
</div>

<style>
	.post-actions {
		grid-template-columns: repeat(var(--post-action-columns), minmax(0, 1fr));
	}

	.post-actions :global([data-slot="button"]:not(.dislike-choice)) {
		pointer-events: auto;
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
