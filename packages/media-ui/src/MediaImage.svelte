<script lang="ts">
	// Opens visible encrypted images and releases their bytes when the view leaves
	import { untrack } from 'svelte';
	import { Button } from '@kaordo/ui';
	import type { MediaAttachment } from './media-layout.ts';

	let {
		media,
		alt,
		linkLabel,
		cropped = false,
		contain = false
	}: {
		media: MediaAttachment;
		alt: string;
		linkLabel?: string;
		cropped?: boolean;
		contain?: boolean;
	} = $props();
	let image = $state<HTMLImageElement>();
	let openedURL = $state('');
	let error = $state('');
	let retry = $state(0);
	const mediaId = $derived(media.id);
	const url = $derived(media.loadURL ? openedURL : media.url);

	$effect(() => {
		const id = mediaId;
		// Metadata refreshes keep a mounted image's lease; deferred loads read the newest signed source
		const deferred = untrack(() => !!media.loadURL);
		const node = image;
		const attempt = retry;
		openedURL = '';
		error = '';
		if (!deferred || !node) return;
		const controller = new AbortController();
		const load = async () => {
			try {
				const open = untrack(() => media.loadURL);
				if (!open) return;
				const value = await open(controller.signal);
				controller.signal.throwIfAborted();
				if (mediaId !== id) return;
				openedURL = value;
			} catch (cause) {
				if (!controller.signal.aborted)
					error = cause instanceof Error ? cause.message : 'The image could not load.';
			}
		};
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer.disconnect();
				void load();
			},
			{ rootMargin: '300px' }
		);
		if (attempt > 0) void load();
		else observer.observe(node);
		return () => {
			observer.disconnect();
			controller.abort();
		};
	});
</script>

{#snippet picture()}
	<img
		bind:this={image}
		src={url || undefined}
		{alt}
		width={media.width}
		height={media.height}
		loading="lazy"
		decoding="async"
		draggable="false"
		class="block h-full w-full object-center"
		class:object-contain={contain}
		class:object-cover={!contain}
	/>
{/snippet}

{#if linkLabel}
	<span class="relative block h-full w-full">
		<a
			data-pswp-item
			data-media-id={media.id}
			href={url || undefined}
			rel="external"
			data-pswp-width={media.width}
			data-pswp-height={media.height}
			data-cropped={cropped ? 'true' : undefined}
			class="block h-full w-full overflow-hidden outline-offset-[-4px] focus-visible:rounded-xl focus-visible:outline-3 focus-visible:outline-ring"
			aria-label={linkLabel}
		>
			{@render picture()}
		</a>
		{#if error}
			<span
				class="absolute inset-0 grid place-content-center gap-2 bg-muted p-3 text-center text-xs"
			>
				<span role="alert">{error}</span>
				<Button variant="outline" size="sm" onclick={() => retry++}>Try again</Button>
			</span>
		{/if}
	</span>
{:else}
	{@render picture()}
{/if}
