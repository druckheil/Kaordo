import { authorizedFetch, refreshAccessToken } from '@kaordo/auth';

export async function sessionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  let response = await authorizedFetch(request.clone());
  if (response.status === 401) {
    await refreshAccessToken();
    response = await authorizedFetch(request.clone());
  }
  return response;
}

export function apiError(error: unknown, status: number): Error {
  const detail = error && typeof error === 'object' && 'error' in error && typeof error.error === 'string'
    ? error.error : `Request failed (${status}).`;
  return new Error(detail);
}
