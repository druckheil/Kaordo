const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
} as const;

export function json(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(JSON_HEADERS);
  if (headers) {
    new Headers(headers).forEach((value, name) => responseHeaders.append(name, value));
  }
  return new Response(JSON.stringify(body), {
    headers: responseHeaders,
    status,
  });
}

export type ReadJsonObjectOptions = {
  invalidMessage: string;
  maxBytes: number;
  tooLargeMessage: string;
};

export class JsonRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonRequestError';
  }
}

/**
 * Reads a JSON object without allowing a chunked request to grow beyond the
 * endpoint limit. `request.text()` only exposes the size after buffering the
 * complete body, which is unsafe for public Worker routes.
 */
export async function readJsonObject(
  request: Request,
  options: ReadJsonObjectOptions,
): Promise<Record<string, unknown>> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new JsonRequestError(options.invalidMessage);
    }
    if (bytes > options.maxBytes) throw new JsonRequestError(options.tooLargeMessage);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new JsonRequestError(options.invalidMessage);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel(options.tooLargeMessage).catch(() => undefined);
        throw new JsonRequestError(options.tooLargeMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new JsonRequestError(options.invalidMessage);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JsonRequestError(options.invalidMessage);
  }
  return value as Record<string, unknown>;
}
