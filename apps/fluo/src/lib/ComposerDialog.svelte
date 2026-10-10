<script lang="ts">
	// Bounds the composer layout and preserves drafts through its closing transition

	import type { FluoApi } from '@kaordo/api-client';
	import type { FluoPost } from '@kaordo/contracts';
	import { Dialog } from '@kaordo/ui';
	import Composer from './Composer.svelte';

	let {
		api,
		replyTo,
		quoteTo,
		open,
		onOpenChange,
		onRemoveQuote,
		onPublished
	}: {
		api: FluoApi;
		replyTo: FluoPost | null;
		quoteTo: FluoPost | null;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onRemoveQuote: () => void;
		onPublished: () => void;
	} = $props();

	let retainedReply = $state<FluoPost | null>(null);
	let retainedQuote = $state<FluoPost | null>(null);
	const visibleReply = $derived(open ? replyTo : retainedReply);
	const visibleQuote = $derived(open ? quoteTo : retainedQuote);

	// Bits UI owns unmounting; retain the context while its exit animation runs
	$effect(() => {
		if (!open) return;
		retainedReply = replyTo;
		retainedQuote = quoteTo;
	});
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content
		class="flex max-h-[min(44rem,90dvh)] flex-col gap-5 overflow-hidden p-4 transition-none sm:max-w-2xl sm:p-6"
	>
		<Dialog.Header class="shrink-0 pr-12">
			<Dialog.Title class="text-xl font-bold tracking-tight">
				{visibleReply ? 'Reply to post' : visibleQuote ? 'Quote post' : 'Create a post'}
			</Dialog.Title>
			<Dialog.Description class="sr-only"
				>Write a post and optionally attach media or change post options.</Dialog.Description
			>
		</Dialog.Header>
		<Composer
			{api}
			replyTo={visibleReply}
			quoteTo={visibleQuote}
			{onPublished}
			onCancel={onRemoveQuote}
		/>
	</Dialog.Content>
</Dialog.Root>
