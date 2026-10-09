<script lang="ts">
	// Connects the post composer and delete confirmation dialog

	import type { FluoApi } from '@kaordo/api-client';
	import type { FluoPost } from '@kaordo/contracts';
	import ComposerDialog from './ComposerDialog.svelte';
	import DeletePostDialog from './DeletePostDialog.svelte';

	let {
		api,
		replyTo,
		quoteTo,
		composerOpen,
		deleteTarget,
		deleteError,
		deleting,
		onComposerOpenChange,
		onRemoveQuote,
		onPublished,
		onDeleteOpenChange,
		onConfirmDelete
	}: {
		api: FluoApi;
		replyTo: FluoPost | null;
		quoteTo: FluoPost | null;
		composerOpen: boolean;
		deleteTarget: FluoPost | null;
		deleteError: string;
		deleting: boolean;
		onComposerOpenChange: (open: boolean) => void;
		onRemoveQuote: () => void;
		onPublished: () => void;
		onDeleteOpenChange: (open: boolean) => void;
		onConfirmDelete: () => void;
	} = $props();
</script>

<ComposerDialog
	{api}
	{replyTo}
	{quoteTo}
	open={composerOpen}
	onOpenChange={onComposerOpenChange}
	{onRemoveQuote}
	{onPublished}
/>

<DeletePostDialog
	post={deleteTarget}
	error={deleteError}
	{deleting}
	onOpenChange={onDeleteOpenChange}
	onConfirm={onConfirmDelete}
/>
