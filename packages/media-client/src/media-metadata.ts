// Reads local media geometry with cancellation and a bounded video metadata lifetime
export async function mediaDimensions(
	file: File,
	signal?: AbortSignal
): Promise<{ width: number; height: number }> {
	signal?.throwIfAborted();
	if (file.type.startsWith('image/')) {
		const image = await createImageBitmap(file);
		try {
			signal?.throwIfAborted();
			return { width: image.width, height: image.height };
		} finally {
			image.close();
		}
	}
	if (!file.type.startsWith('video/')) return { width: 0, height: 0 };
	const source = URL.createObjectURL(file);
	const video = document.createElement('video');
	const timeout = AbortSignal.timeout(15000);
	const lifetime = signal ? AbortSignal.any([signal, timeout]) : timeout;
	try {
		return await new Promise((resolve, reject) => {
			const cleanup = () => {
				lifetime.removeEventListener('abort', abort);
				video.onloadedmetadata = null;
				video.onerror = null;
			};
			const abort = () => {
				cleanup();
				reject(lifetime.reason);
			};
			video.onloadedmetadata = () => {
				cleanup();
				if (video.videoWidth && video.videoHeight)
					resolve({ width: video.videoWidth, height: video.videoHeight });
				else reject(new Error('The video has no supported visual track.'));
			};
			video.onerror = () => {
				cleanup();
				reject(new Error('The video could not be read.'));
			};
			lifetime.addEventListener('abort', abort, { once: true });
			video.preload = 'metadata';
			video.src = source;
		});
	} finally {
		video.removeAttribute('src');
		video.load();
		URL.revokeObjectURL(source);
	}
}
