import { describe, expect, it } from 'vitest';
import { readJsonObject } from '../src/http/json';

const OPTIONS = {
  invalidMessage: 'Invalid JSON.',
  maxBytes: 16,
  tooLargeMessage: 'JSON is too large.',
};

describe('bounded JSON requests', () => {
  it('reads a small object', async () => {
    const request = new Request('https://example.test', {
      body: JSON.stringify({ ok: true }),
      method: 'POST',
    });

    await expect(readJsonObject(request, OPTIONS)).resolves.toEqual({ ok: true });
  });

  it('stops a chunked body as soon as it crosses the limit', async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    let cancelled = false;
    const request = new Request('https://example.test', {
      body: new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
          pull(controller) {
            pulls += 1;
            controller.enqueue(encoder.encode('123456789'));
            if (pulls === 3) controller.close();
          },
        },
        { highWaterMark: 0 },
      ),
      method: 'POST',
    });

    await expect(readJsonObject(request, OPTIONS)).rejects.toMatchObject({
      message: 'JSON is too large.',
      name: 'JsonRequestError',
    });
    expect(cancelled).toBe(true);
    expect(pulls).toBe(2);
  });

  it('rejects arrays and malformed JSON as invalid input', async () => {
    const array = new Request('https://example.test', { body: '[]', method: 'POST' });
    const malformed = new Request('https://example.test', { body: '{', method: 'POST' });

    await expect(readJsonObject(array, OPTIONS)).rejects.toThrow('Invalid JSON.');
    await expect(readJsonObject(malformed, OPTIONS)).rejects.toThrow('Invalid JSON.');
  });
});
