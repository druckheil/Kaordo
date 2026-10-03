<script lang="ts">
	// Keeps the post composer open through its closing transition

	import type { FluoApi } from "@kaordo/api-client";
	import type { FluoPost } from "@kaordo/contracts";
	import { Dialog } from "@kaordo/ui";
	import Composer from "./Composer.svelte";

	let {
		api,
		replyTo,
		quoteTo,
		open,
		onOpenChange,
		onRemoveQuote,
		onPublished,
	}: {
		api: FluoApi;
		replyTo: FluoPost | null;
		quoteTo: FluoPost | null;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onRemoveQuote: () => void;
		onPublished: () => void;
	} = $props();

	let closing = $state(false);
	let wasOpen = false;
	let closingReply = $state<FluoPost | null>(null);
	let closingQuote = $state<FluoPost | null>(null);
	const visibleReply = $derived(open ? replyTo : closingReply);
	const visibleQuote = $derived(open ? quoteTo : closingQuote);

	$effect(() => {
		if (open) {
			wasOpen = true;
			closing = false;
			closingReply = replyTo;
			closingQuote = quoteTo;
			return;
		}
		if (!wasOpen) return;

		closing = true;
		const timer = setTimeout(() => {
			closing = false;
			wasOpen = false;
		}, 180);
		return () => clearTimeout(timer);
	});
</script>

<Dialog.Root open={open} onOpenChange={onOpenChange}>
	<Dialog.Content class="max-h-[90dvh] overflow-hidden p-2 sm:max-w-2xl">
		<div class="kaordo-scrollbar min-w-0 max-h-[calc(90dvh-1rem)] overflow-y-auto p-2 sm:p-4">
			<Dialog.Header class="mb-5 pr-12">
				<Dialog.Title class="text-xl font-bold tracking-tight">
					{visibleReply ? "Reply to post" : visibleQuote ? "Quote post" : "Create a post"}
				</Dialog.Title>
				<Dialog.Description class="sr-only">Write a post and optionally attach media or change post options.</Dialog.Description>
			</Dialog.Header>
			{#if open || closing}
				<Composer {api} replyTo={visibleReply} quoteTo={visibleQuote} onPublished={onPublished} onCancel={onRemoveQuote} />
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
