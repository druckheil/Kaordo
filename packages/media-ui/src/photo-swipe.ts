// Mounts and disposes the optional PhotoSwipe image viewer

import 'photoswipe/style.css';
import type PhotoSwipeLightbox from 'photoswipe/lightbox';
import type { Content } from 'photoswipe/lightbox';
import type { SlideData } from 'photoswipe';
import type { MediaAttachment } from './media-layout.ts';

export function mountPhotoSwipe(
	gallery: HTMLElement | undefined,
	media: () => MediaAttachment[] = () => []
): () => void {
	let active = true;
	let lightbox: PhotoSwipeLightbox | undefined;
	const readers = new Map<Content, AbortController>();
	const ready = new WeakSet<Content>();
	const attachment = (data: SlideData) => {
		const id = data.element instanceof HTMLElement ? data.element.dataset.mediaId : undefined;
		return id ? media().find((item) => item.id === id) : undefined;
	};
	function release(content: Content): void {
		readers.get(content)?.abort();
		readers.delete(content);
		ready.delete(content);
	}

	if (gallery) {
		void import('photoswipe/lightbox').then(({ default: PhotoSwipeLightbox }) => {
			if (!active) return;

			lightbox = new PhotoSwipeLightbox({
				gallery,
				children: 'a[data-pswp-item]',
				pswpModule: () => import('photoswipe')
			});
			lightbox.addFilter('itemData', (data) => {
				if (attachment(data)?.loadURL) data.type = 'image';
				return data;
			});
			lightbox.on('contentLoadImage', (event) => {
				const content: Content = event.content;
				const load = attachment(content.data)?.loadURL;
				if (!load || ready.has(content)) return;
				event.preventDefault();
				if (readers.has(content)) return;
				const controller = new AbortController();
				readers.set(content, controller);
				content.state = 'loading';
				void load(controller.signal)
					.then((url) => {
						if (controller.signal.aborted) return;
						content.data.src = url;
						ready.add(content);
						content.loadImage(false);
					})
					.catch(() => {
						if (!controller.signal.aborted) content.onError();
					});
			});
			lightbox.on('contentDestroy', ({ content }) => release(content));
			lightbox.on('destroy', () => {
				for (const content of readers.keys()) release(content);
			});
			lightbox.init();
		});
	}

	return () => {
		active = false;
		lightbox?.destroy();
		for (const content of readers.keys()) release(content);
	};
}
