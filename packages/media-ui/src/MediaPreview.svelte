<script lang="ts">
	// Shows medium photos and static video placeholders inside a parent post link
	import { PlayIcon } from '@kaordo/ui';
	import { mediaFrameRatio, type MediaAttachment } from './media-layout';

	let { media }: { media: MediaAttachment[] } = $props();
</script>

{#if media.length}
	<span
		class="mt-3 flex max-w-lg min-w-0 flex-wrap gap-2"
		class:media-preview-grid={media.length > 1}
		role="group"
		aria-label="Post media previews"
	>
		{#each media as item, index (item.id)}
			<span
				class="relative block max-h-44 max-w-full min-w-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border"
				style:width={media.length === 1 ? `min(100%, ${11 * mediaFrameRatio(item)}rem)` : '100%'}
				style:aspect-ratio={media.length === 1 ? mediaFrameRatio(item) : 4 / 3}
			>
				{#if item.kind === 'image'}
					<img
						src={item.url}
						alt={item.altText || `Image ${index + 1} attached to this post`}
						width={item.width}
						height={item.height}
						loading="lazy"
						decoding="async"
						draggable="false"
						class="block h-full w-full object-contain"
					/>
				{:else}
					<span
						class="block h-full w-full bg-black"
						role="img"
						aria-label={item.altText || `Video ${index + 1} attached to this post`}
					>
						<span
							class="pointer-events-none absolute inset-0 grid place-items-center"
							aria-hidden="true"
						>
							<span
								class="grid size-10 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/25 backdrop-blur-sm"
							>
								<PlayIcon class="size-5 fill-current" />
							</span>
						</span>
					</span>
				{/if}
			</span>
		{/each}
	</span>
{/if}

<style>
	.media-preview-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
	}
</style>
