<script lang="ts">
	// Renders responsive post media with carousel and image lightbox support
	import type { EmblaCarouselType } from 'embla-carousel';
	import useEmblaCarousel from 'embla-carousel-svelte';
	import { Button, ChevronLeftIcon, ChevronRightIcon } from '@kaordo/ui';
	import type { MediaAttachment } from './media-layout';
	import {
		maxMediaHeightRem,
		maxMediaRatio,
		mediaCarouselViewportRatio,
		mediaFrameRatio,
		mediaGapPx,
		mediaPositionLabel,
		mediaStripMaxWidth,
		minMediaRatio
	} from './media-layout';
	import { mountPhotoSwipe } from './photo-swipe';
	import VideoPlayer from './VideoPlayer.svelte';
	import MediaImage from './MediaImage.svelte';

	interface Props {
		media: MediaAttachment[];
		label?: string;
		edgeBleed?: boolean;
		showPositionLabel?: boolean;
	}

	let {
		media,
		label = 'Post media',
		edgeBleed = false,
		showPositionLabel = true
	}: Props = $props();
	let gallery = $state<HTMLDivElement>();
	let carousel = $state.raw<EmblaCarouselType | null>(null);
	let visible = $state<number[]>([0]);
	let canPrev = $state(false);
	let canNext = $state(false);

	const firstAttachment = $derived(media[0]);
	const hasImages = $derived(media.some(isImage));
	const ratios = $derived(media.map(mediaFrameRatio));
	const pairedPhotos = $derived(media.length === 2 && media.every(isImage));
	const pairAspectRatio = $derived(
		pairedPhotos ? ratios.reduce((sum, ratio) => sum + ratio, 0) : 1
	);
	const pairColumns = $derived(`${ratios[0] ?? 1}fr ${ratios[1] ?? 1}fr`);
	const carouselAspectRatio = $derived(mediaCarouselViewportRatio(ratios));
	const stripMaxWidth = $derived(mediaStripMaxWidth(ratios));
	const positionLabel = $derived(mediaPositionLabel(visible, media.length));
	const edgeBleedCarousel = $derived(edgeBleed && media.length > 2);

	const carouselOptions = {
		align: 'start' as const,
		containScroll: 'trimSnaps' as const,
		slidesToScroll: 1,
		dragFree: true,
		inViewThreshold: 0.15,
		loop: false,
		duration:
			typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
				? 0
				: 22
	};

	$effect(() => {
		if (!hasImages) return;
		return mountPhotoSwipe(gallery, () => media);
	});

	function isImage(item: MediaAttachment): boolean {
		return item.kind === 'image';
	}

	function isExtreme(item: MediaAttachment): boolean {
		const naturalRatio = item.width / item.height;
		return naturalRatio < minMediaRatio || naturalRatio > maxMediaRatio;
	}

	function imageAltText(item: MediaAttachment, index: number): string {
		if (item.altText) return item.altText;

		return `Image ${index + 1} attached to this ${mediaContext()}`;
	}

	function mediaContext(): string {
		if (label === 'Post media') return 'post';
		if (label === 'Reply media') return 'reply';
		return 'message';
	}

	function syncCarousel(api: EmblaCarouselType): void {
		const visibleSlides = api.slidesInView();
		if (visibleSlides.length) visible = visibleSlides;

		canPrev = api.canScrollPrev();
		canNext = api.canScrollNext();
	}

	function initialized(event: CustomEvent<EmblaCarouselType>): void {
		const api = event.detail;
		const sync = () => syncCarousel(api);

		carousel = api;
		api.on('select', sync);
		api.on('slidesInView', sync);
		api.on('reInit', sync);
		sync();
	}

	function scrollPrevious(): void {
		carousel?.scrollPrev();
	}

	function scrollNext(): void {
		carousel?.scrollNext();
	}
</script>

{#snippet attachment(item: MediaAttachment, index: number)}
	{#if isImage(item)}
		<MediaImage
			media={item}
			alt={imageAltText(item, index)}
			linkLabel={`Open image ${index + 1} of ${media.length}`}
			cropped={isExtreme(item)}
		/>
	{:else}
		<VideoPlayer media={item} />
	{/if}
{/snippet}

{#if firstAttachment}
	<div
		bind:this={gallery}
		class="mt-4 w-full min-w-0"
		class:media-gallery-bleed={edgeBleedCarousel}
		aria-label={`${label} attachments`}
	>
		{#if media.length === 1}
			<div
				class="mx-auto max-w-full overflow-hidden rounded-2xl ring-1 ring-border"
				style:width={`min(100%, ${maxMediaHeightRem * ratios[0]}rem)`}
				style:aspect-ratio={ratios[0]}
			>
				{@render attachment(firstAttachment, 0)}
			</div>
		{:else if pairedPhotos}
			<div
				role="group"
				aria-label={label}
				class="mx-auto grid w-full max-w-full min-w-0 gap-1 rounded-2xl bg-card"
				style:width={`min(100%, ${maxMediaHeightRem * pairAspectRatio}rem)`}
				style:aspect-ratio={pairAspectRatio}
				style:max-height={`${maxMediaHeightRem}rem`}
				style:grid-template-columns={pairColumns}
			>
				{#each media as item, index (item.id)}
					<div class="min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-muted">
						{@render attachment(item, index)}
					</div>
				{/each}
			</div>
		{:else}
			<div
				role="region"
				aria-roledescription="carousel"
				aria-label={label}
				class="relative max-w-full min-w-0"
				style:max-width={stripMaxWidth}
			>
				<div
					class="w-full overflow-hidden"
					style:aspect-ratio={carouselAspectRatio}
					style:max-height={`${maxMediaHeightRem}rem`}
					use:useEmblaCarousel={{ options: carouselOptions, plugins: [] }}
					onemblaInit={initialized}
				>
					<div
						class="box-border flex h-full touch-pan-y py-0.5"
						class:media-gallery-track-bleed={edgeBleedCarousel}
						style:gap={`${mediaGapPx}px`}
					>
						{#each media as item, index (item.id)}
							<div
								class="relative box-border h-full shrink-0 overflow-hidden rounded-xl bg-border"
								style:aspect-ratio={ratios[index]}
								style:--media-frame-inset="2px"
								role="group"
								aria-roledescription="slide"
								aria-label={`${index + 1} of ${media.length}`}
							>
								<div
									class="absolute overflow-hidden bg-muted"
									style:inset="var(--media-frame-inset)"
									style:border-radius="calc(var(--radius-xl) - var(--media-frame-inset))"
								>
									{@render attachment(item, index)}
								</div>
							</div>
						{/each}
					</div>
				</div>

				{#if canPrev || canNext}
					<div
						class="pointer-events-none absolute inset-x-3 top-1/2 flex -translate-y-1/2"
						class:justify-end={!canPrev && canNext}
						class:justify-start={canPrev && !canNext}
						class:justify-between={canPrev && canNext}
					>
						{#if canPrev}
							<Button
								class="pointer-events-auto rounded-full bg-card/95 shadow-lg backdrop-blur-sm"
								size="icon"
								variant="secondary"
								aria-label="Previous attachment"
								onclick={scrollPrevious}
							>
								<ChevronLeftIcon class="size-5" />
							</Button>
						{/if}
						{#if canNext}
							<Button
								class="pointer-events-auto rounded-full bg-card/95 shadow-lg backdrop-blur-sm"
								size="icon"
								variant="secondary"
								aria-label="Next attachment"
								onclick={scrollNext}
							>
								<ChevronRightIcon class="size-5" />
							</Button>
						{/if}
					</div>
				{/if}
			</div>

			{#if showPositionLabel}
				<div class="mt-2 text-right text-xs font-medium text-muted-foreground" aria-live="polite">
					{positionLabel}
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.media-gallery-bleed {
		width: calc(
			100% + var(--media-gallery-edge-gutter, 0px) + var(--media-gallery-edge-gutter, 0px)
		);
		margin-inline: calc(0px - var(--media-gallery-edge-gutter, 0px));
	}

	.media-gallery-track-bleed {
		padding-inline-start: var(--media-gallery-edge-gutter, 0px);
	}

	.media-gallery-track-bleed > :last-child {
		margin-inline-end: var(--media-gallery-edge-gutter, 0px);
	}
</style>
