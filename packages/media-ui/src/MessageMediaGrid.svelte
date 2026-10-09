<script lang="ts">
	// Displays compact message attachments and opens images in PhotoSwipe
	import type { MediaAttachment } from './media-layout';
	import { mediaGridColumns } from './media-layout';
	import { mountPhotoSwipe } from './photo-swipe';
	import VideoPlayer from './VideoPlayer.svelte';
	import MediaImage from './MediaImage.svelte';
	import 'photoswipe/style.css';

	interface Props {
		media: MediaAttachment[];
	}

	let { media }: Props = $props();
	let gallery = $state<HTMLDivElement>();

	const isSingleAttachment = $derived(media.length === 1);
	const hasImages = $derived(media.some(isImage));
	const gridClass = $derived(mediaGridColumns(media.length));
	const frameClass = $derived(isSingleAttachment ? 'aspect-[4/3] max-h-80' : 'aspect-square');

	$effect(() => {
		if (!hasImages) return;
		return mountPhotoSwipe(gallery, () => media);
	});

	function isImage(item: MediaAttachment): boolean {
		return item.kind === 'image';
	}

	function imageAltText(item: MediaAttachment, index: number): string {
		return item.altText || `Image ${index + 1} attached to this message`;
	}
</script>

{#if media.length}
	<div
		bind:this={gallery}
		class={`grid w-full min-w-0 gap-0.5 ${gridClass}`}
		role="group"
		aria-label="Message attachments"
	>
		{#each media as item, index (item.id)}
			<figure class="min-w-0 overflow-hidden rounded-[10px] bg-background/70">
				<div class={`relative w-full overflow-hidden bg-muted ${frameClass}`}>
					{#if isImage(item)}
						<MediaImage
							media={item}
							alt={imageAltText(item, index)}
							linkLabel={`Open image ${index + 1} of ${media.length}`}
						/>
					{:else}
						<VideoPlayer media={item} compact />
					{/if}
				</div>

				{#if item.altText}
					<figcaption class="px-2.5 py-2 text-xs leading-relaxed break-words text-foreground/80">
						{item.altText}
					</figcaption>
				{/if}
			</figure>
		{/each}
	</div>
{/if}
