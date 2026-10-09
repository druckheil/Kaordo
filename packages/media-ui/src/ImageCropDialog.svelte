<script lang="ts">
	// Wraps lazy Cropper.js image selection in the shared accessible dialog

	import { onDestroy } from 'svelte';
	import type Cropper from 'cropperjs';
	import type { CropperSelection } from 'cropperjs';
	import {
		Button,
		Dialog,
		LoaderCircleIcon,
		RotateCcwIcon,
		ZoomInIcon,
		ZoomOutIcon
	} from '@kaordo/ui';
	import { exportCroppedImage, fitCropperSelection } from './cropper-images';

	let {
		file,
		title,
		aspectRatio,
		outputWidth,
		outputHeight,
		onApply,
		onCancel
	}: {
		file: File;
		title: string;
		aspectRatio: number;
		outputWidth: number;
		outputHeight: number;
		onApply: (file: File) => void;
		onCancel: () => void;
	} = $props();

	let cropper: Cropper | undefined;
	let ready = $state(false);
	let hasSelection = $state(false);
	let exporting = $state(false);
	let error = $state('');
	let active = true;
	let resetSelection: (() => void) | undefined;
	onDestroy(() => {
		active = false;
	});

	function mountCropper(node: HTMLDivElement) {
		const url = URL.createObjectURL(file);
		let mounted = true;
		let observer: ResizeObserver | undefined;
		let selection: CropperSelection | null = null;
		const change = (event: Event) => {
			const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
			hasSelection = detail.width > 0 && detail.height > 0;
		};
		const focus = () => {
			if (selection) selection.keyboard = true;
		};
		const blur = () => {
			if (selection) selection.keyboard = false;
		};

		void import('cropperjs')
			.then(async ({ default: Cropper }) => {
				if (!mounted) return;
				const source = new Image();
				source.src = url;
				source.alt = 'Image to crop';
				cropper = new Cropper(source, {
					container: node,
					template: `<cropper-canvas background>
          <cropper-image initial-fit="contain"></cropper-image>
          <cropper-shade hidden></cropper-shade>
          <cropper-selection aspect-ratio="${aspectRatio}" movable resizable zoomable outlined precise>
            <cropper-grid role="presentation" covered></cropper-grid>
            <cropper-crosshair centered></cropper-crosshair>
            <cropper-handle action="move" theme-color="rgba(255,255,255,.12)"></cropper-handle>
            <cropper-handle action="ne-resize"></cropper-handle>
            <cropper-handle action="nw-resize"></cropper-handle>
            <cropper-handle action="se-resize"></cropper-handle>
            <cropper-handle action="sw-resize"></cropper-handle>
          </cropper-selection>
        </cropper-canvas>`
				});
				const image = cropper.getCropperImage();
				const canvas = cropper.getCropperCanvas();
				selection = cropper.getCropperSelection();
				if (!image || !canvas || !selection) throw new Error('Could not open the image cropper.');
				await image.$ready();
				if (!mounted) return;
				const frame = selection;
				resetSelection = () => {
					hasSelection = fitCropperSelection(image, canvas, frame, aspectRatio);
				};
				selection.tabIndex = 0;
				selection.setAttribute('role', 'group');
				selection.setAttribute(
					'aria-label',
					'Crop frame. Arrow keys move the frame; plus and minus resize it.'
				);
				selection.addEventListener('change', change);
				selection.addEventListener('focus', focus);
				selection.addEventListener('blur', blur);
				resetSelection();
				observer = new ResizeObserver(() => resetSelection?.());
				observer.observe(canvas);
				ready = true;
			})
			.catch((cause: unknown) => {
				if (mounted) error = cause instanceof Error ? cause.message : 'Could not load this image.';
			});

		return {
			destroy() {
				mounted = false;
				observer?.disconnect();
				selection?.removeEventListener('change', change);
				selection?.removeEventListener('focus', focus);
				selection?.removeEventListener('blur', blur);
				cropper?.destroy();
				cropper = undefined;
				resetSelection = undefined;
				URL.revokeObjectURL(url);
			}
		};
	}

	async function apply() {
		const selection = cropper?.getCropperSelection();
		if (!selection || !hasSelection || exporting) return;
		exporting = true;
		error = '';
		try {
			const image = await exportCroppedImage(selection, outputWidth, outputHeight);
			if (active) onApply(image);
		} catch (cause) {
			if (active) error = cause instanceof Error ? cause.message : 'Could not crop this image.';
		} finally {
			if (active) exporting = false;
		}
	}
</script>

<Dialog.Root
	open
	onOpenChange={(open) => {
		if (!open && !exporting) onCancel();
	}}
>
	<Dialog.Content
		class="gap-4 sm:max-w-xl"
		onInteractOutside={(event) => {
			if (exporting) event.preventDefault();
		}}
		onEscapeKeydown={(event) => {
			if (exporting) event.preventDefault();
		}}
		showCloseButton={!exporting}
	>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description
				>Drag or resize the frame to choose what appears in your profile.</Dialog.Description
			>
		</Dialog.Header>
		<div
			use:mountCropper
			class="crop-stage relative h-[min(42dvh,21rem)] min-h-40 overflow-hidden rounded-2xl border border-border bg-muted"
			aria-busy={!ready}
		></div>
		{#if !ready && !error}<p class="text-center text-sm text-muted-foreground" role="status">
				Loading image…
			</p>{/if}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<p class="text-xs text-muted-foreground">
				{aspectRatio === 1 ? 'Square avatar' : 'Wide banner · 3:1'}
			</p>
			<div class="flex items-center gap-1" role="group" aria-label="Crop controls">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Make crop frame smaller"
					disabled={!ready || exporting}
					onclick={() => cropper?.getCropperSelection()?.$zoom(-0.1)}
					><ZoomInIcon class="size-4" /></Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Make crop frame larger"
					disabled={!ready || exporting}
					onclick={() => cropper?.getCropperSelection()?.$zoom(0.1)}
					><ZoomOutIcon class="size-4" /></Button
				>
				<Button
					variant="ghost"
					size="sm"
					disabled={!ready || exporting}
					onclick={() => resetSelection?.()}><RotateCcwIcon class="size-4" />Reset</Button
				>
			</div>
		</div>
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
		<Dialog.Footer>
			<Button variant="outline" disabled={exporting} onclick={onCancel}>Cancel</Button>
			<Button disabled={!ready || !hasSelection || exporting} onclick={() => void apply()}>
				{#if exporting}<LoaderCircleIcon class="size-4 motion-safe:animate-spin" />{/if}
				{exporting ? 'Cropping…' : 'Use image'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.crop-stage :global(cropper-canvas) {
		width: 100%;
		height: 100%;
	}
	.crop-stage :global(cropper-selection:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}
</style>
