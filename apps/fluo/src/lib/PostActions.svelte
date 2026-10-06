<script lang="ts">
	// Renders the available reactions and post actions

	import type { FluoPost } from "@kaordo/contracts";
	import {
		BookmarkIcon,
		Button,
		MessageCircleIcon,
		Repeat2Icon,
		Share2Icon,
	} from "@kaordo/ui";
	import PostReaction from "./PostReaction.svelte";
	import type { FluoPostActionHandlers } from "./post-actions";

	let { post, onReply, onQuote, onReact, onSave, showReplyAction = true }: {
		post: FluoPost;
		onReply: () => void;
		onQuote: () => void;
		onReact: (value: FluoPost['myReaction']) => ReturnType<FluoPostActionHandlers['react']>;
		onSave: () => Promise<void>;
		showReplyAction?: boolean;
	} = $props();

	let saving = $state(false);
	const actionButtonClass = "pointer-events-auto h-11 min-w-0 flex-1 gap-1 px-0 disabled:pointer-events-auto sm:gap-2 sm:px-3";
	const showQuoteAction = $derived(post.visibility === "public");

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
	class="pointer-events-none relative z-10 mt-1 flex gap-1.5 sm:gap-3"
	role="group" aria-label="Post actions"
>
	{#if showReplyAction}
		<Button class={actionButtonClass} variant="ghost" size="sm"
			aria-label={`Reply, ${post.counts.comments}`} onclick={onReply}>
			<MessageCircleIcon class="size-5" />
			<span class="min-w-0 truncate text-xs tabular-nums sm:text-sm">{post.counts.comments}</span>
		</Button>
	{/if}

	{#if showQuoteAction}
		<Button class={actionButtonClass} variant="ghost" size="sm"
			aria-label={`Quote, ${post.counts.quotes}`} onclick={onQuote}>
			<Repeat2Icon class="size-5" />
			<span class="min-w-0 truncate text-xs tabular-nums sm:text-sm">{post.counts.quotes}</span>
		</Button>
	{/if}

	<PostReaction {post} {onReact} />

	<Button class={actionButtonClass} variant={post.saved ? "secondary" : "ghost"}
		size="sm" aria-label={`${post.saved ? "Remove from saved posts" : "Save post"}, ${post.counts.saves}`}
		aria-pressed={post.saved} aria-busy={saving} disabled={saving} onclick={() => void toggleSaved()}>
		<BookmarkIcon class={post.saved ? "size-5 fill-current" : "size-5"} />
		<span class="min-w-0 truncate text-xs tabular-nums sm:text-sm">{post.counts.saves}</span>
	</Button>

	<Button class={actionButtonClass} variant="ghost" size="sm"
		aria-label="Share post" disabled>
		<Share2Icon class="size-5" />
	</Button>
</div>
