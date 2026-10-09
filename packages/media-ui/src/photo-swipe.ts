// Mounts and disposes the optional PhotoSwipe image viewer

import 'photoswipe/style.css';

interface PhotoSwipeInstance {
	init: () => void;
	destroy: () => void;
}

export function mountPhotoSwipe(gallery: HTMLElement | undefined): () => void {
	let active = true;
	let lightbox: PhotoSwipeInstance | undefined;

	if (gallery) {
		void import('photoswipe/lightbox').then(({ default: PhotoSwipeLightbox }) => {
			if (!active) return;

			lightbox = new PhotoSwipeLightbox({
				gallery,
				children: 'a[data-pswp-item]',
				pswpModule: () => import('photoswipe')
			});
			lightbox.init();
		});
	}

	return () => {
		active = false;
		lightbox?.destroy();
	};
}
