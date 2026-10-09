// Bounds attachment downloads while streaming so an invalid response cannot allocate an unbounded buffer
export async function readResponseBytes(
	response: Response,
	expectedSize: number
): Promise<Uint8Array<ArrayBuffer>> {
	if (
		!Number.isSafeInteger(expectedSize) ||
		expectedSize < 1 ||
		expectedSize > 100 * 1024 * 1024 + 36
	)
		throw new Error('Invalid attachment size.');
	const declaredSize = Number(response.headers.get('content-length'));
	if (declaredSize > expectedSize) {
		await response.body?.cancel();
		throw new Error('The attachment exceeds its expected size.');
	}
	if (!response.body) throw new Error('The attachment has no content.');
	const reader = response.body.getReader();
	const bytes = new Uint8Array(expectedSize);
	let offset = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (offset + value.byteLength > expectedSize)
				throw new Error('The attachment exceeds its expected size.');
			bytes.set(value, offset);
			offset += value.byteLength;
		}
		if (offset !== expectedSize) throw new Error('The attachment is incomplete.');
		return bytes;
	} catch (cause) {
		await reader.cancel().catch(() => {});
		throw cause;
	} finally {
		reader.releaseLock();
	}
}
