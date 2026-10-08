// Creates the authenticated application account session with a bounded token refresh
import { authorizedFetch, refreshAccessToken } from '@kaordo/auth';
import type { UserIdentity, paths } from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { apiErrorDetail } from './http.ts';

export async function bootstrapIdentity(
  apiBaseUrl: string,
  auth: { fetch: typeof authorizedFetch; refresh: typeof refreshAccessToken } =
    { fetch: authorizedFetch, refresh: refreshAccessToken },
  signal?: AbortSignal
): Promise<UserIdentity> {
  signal?.throwIfAborted();
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: auth.fetch });
  const requestSession = () => client.POST('/v1/session', { headers: { Accept: 'application/json' }, signal });
  let result = await requestSession();

  if (result.response.status === 401) {
    signal?.throwIfAborted();
    await auth.refresh();
    signal?.throwIfAborted();
    result = await requestSession();
  }

  return requireIdentity(result.data, result.error, result.response.status);
}

function requireIdentity(data: UserIdentity | undefined, error: unknown, status: number): UserIdentity {
  if (data) return data;

  const detail = apiErrorDetail(error);
  const message = `Account setup failed (${status}).${detail ? ` ${detail}` : ''}`;
  throw new Error(message);
}
