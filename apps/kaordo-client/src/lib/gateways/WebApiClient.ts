/** Shared JSON transport for browser gateways. */
export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  fallback: string,
  timeoutMilliseconds?: number,
): Promise<T> {
  const response = await browserFetch(path, init, timeoutMilliseconds);
  return decodeJsonResponse<T>(response, fallback);
}

export function browserFetch(
  path: string,
  init: RequestInit = {},
  timeoutMilliseconds?: number,
): Promise<Response> {
  if (!timeoutMilliseconds || timeoutMilliseconds <= 0) {
    return fetch(path, browserRequest(init));
  }

  const controller = new AbortController();
  const sourceSignal = init.signal;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMilliseconds);
  const abortFromSource = () => controller.abort();

  if (sourceSignal) {
    if (sourceSignal.aborted) controller.abort();
    else sourceSignal.addEventListener('abort', abortFromSource, { once: true });
  }

  return fetch(path, browserRequest({ ...init, signal: controller.signal }))
    .catch((error: unknown) => {
      if (timedOut) throw new Error(`Request timed out after ${timeoutMilliseconds} ms.`);
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
      sourceSignal?.removeEventListener('abort', abortFromSource);
    });
}

export async function decodeJsonResponse<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiError(value, fallback));
  return value as T;
}

function browserRequest(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  return { ...init, credentials: 'include', headers };
}

function apiError(value: unknown, fallback: string): string {
  return typeof value === 'object' && value !== null && 'error' in value
    && typeof value.error === 'string' && value.error.trim()
    ? value.error
    : fallback;
}
