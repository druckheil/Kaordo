<script lang="ts">
	// Renders the available reactions and post actions

	import { onDestroy } from 'svelte';
	import type { FluoPost } from "@kaordo/contracts";
	import {
		BookmarkIcon,
		Button,
		CheckIcon,
		Dialog,
		Input,
		MessageCircleIcon,
		Repeat2Icon,
		Share2Icon,
	} from "@kaordo/ui";
	import PostReaction from "./PostReaction.svelte";
	import type { FluoPostActionHandlers } from "./post-actions";
	import { postHashForId } from './fluo-model';

	let { post, onReply, onQuote, onReact, onSave, showReplyAction = true }: {
		post: FluoPost;
		onReply: () => void;
		onQuote: () => void;
		onReact: (value: FluoPost['myReaction']) => ReturnType<FluoPostActionHandlers['react']>;
		onSave: () => Promise<void>;
		showReplyAction?: boolean;
	} = $props();

	let saving = $state(false);
	let sharing = $state(false);
	let copied = $state(false);
	let shareOpen = $state(false);
	let shareUrl = $state('');
	let shareButton = $state<HTMLButtonElement | null>(null);
	let disposed = false;
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => { disposed = true; if (copiedTimer) clearTimeout(copiedTimer); });
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

	async function sharePost(): Promise<void> {
		if (sharing) return;
		sharing = true;
		shareUrl = new URL(postHashForId(post.id), window.location.href).href;
		try {
			if (navigator.share) await navigator.share({ title: `${post.author.displayName}'s post`, url: shareUrl });
			else {
				await navigator.clipboard.writeText(shareUrl);
				if (disposed) return;
				copied = true;
				if (copiedTimer) clearTimeout(copiedTimer);
				copiedTimer = setTimeout(() => { copied = false; }, 3000);
			}
		} catch (cause) {
			if (!disposed && !(cause instanceof DOMException && cause.name === 'AbortError')) shareOpen = true;
		} finally { if (!disposed) sharing = false; }
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

	{#if post.visibility === 'public'}
		<Button bind:ref={shareButton} class={actionButtonClass} variant="ghost" size="sm"
			aria-label={copied ? 'Post link copied' : 'Share post'} title={copied ? 'Link copied' : 'Share post'}
			aria-busy={sharing} disabled={sharing} onclick={() => void sharePost()}>
			{#if copied}<CheckIcon class="size-5 text-link" />{:else}<Share2Icon class="size-5" />{/if}
		</Button>
	{/if}
	<span class="sr-only" role="status">{copied ? 'Post link copied to clipboard.' : ''}</span>
</div>

<Dialog.Root bind:open={shareOpen}>
	<Dialog.Content class="sm:max-w-md" onCloseAutoFocus={(event) => { event.preventDefault(); shareButton?.focus({ preventScroll: true }); }}>
		<Dialog.Header><Dialog.Title>Share post</Dialog.Title><Dialog.Description>Copy this link to share the post.</Dialog.Description></Dialog.Header>
		<Input aria-label="Post link" value={shareUrl} readonly onfocus={(event) => event.currentTarget.select()} />
		<Dialog.Footer><Button onclick={() => { shareOpen = false; }}>Done</Button></Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
