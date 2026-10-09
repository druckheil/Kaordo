<script lang="ts">
	// Opens encrypted file bytes only for an explicit download and releases them with the action
	import { onMount } from 'svelte';
	import { Attachment } from '@kaordo/ui';

	let {
		file
	}: {
		file: {
			filename: string;
			url: string;
			loadURL?: (signal: AbortSignal) => Promise<string>;
		};
	} = $props();
	let url = $state('');
	let loading = $state(false);
	let error = $state('');
	const lifetime = new AbortController();
	onMount(() => () => lifetime.abort());

	async function download(): Promise<void> {
		if (loading || !file.loadURL) return;
		loading = true;
		error = '';
		try {
			if (!url) url = await file.loadURL(lifetime.signal);
			lifetime.signal.throwIfAborted();
			const link = document.createElement('a');
			link.href = url;
			link.download = file.filename;
			document.body.append(link);
			link.click();
			link.remove();
		} catch (cause) {
			if (!lifetime.signal.aborted)
				error = cause instanceof Error ? cause.message : 'The file could not download.';
		} finally {
			loading = false;
		}
	}
</script>

{#if file.loadURL}
	<Attachment.Action
		disabled={loading}
		onclick={() => void download()}
		aria-label={`Download ${file.filename}`}
	>
		{loading ? 'Opening…' : 'Download'}
	</Attachment.Action>
	{#if error}<span role="alert" class="text-xs text-destructive">{error}</span>{/if}
{:else}
	<Attachment.Action
		href={file.url}
		download={file.filename}
		rel="noreferrer"
		aria-label={`Download ${file.filename}`}>Download</Attachment.Action
	>
{/if}
