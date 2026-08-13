/** Shared JSON transport for browser gateways. */
export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  fallback: string,
): Promise<T> {
  const response = await browserFetch(path, init);
  return decodeJsonResponse<T>(response, fallback);
}

export function browserFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, browserRequest(init));
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
