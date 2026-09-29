import { authorizedFetch, refreshAccessToken } from '@kaordo/auth';
import type { UserIdentity, paths } from '@kaordo/contracts';
import createClient from 'openapi-fetch';

export async function bootstrapIdentity(
  apiBaseUrl: string,
  auth: { fetch: typeof authorizedFetch; refresh: typeof refreshAccessToken } =
    { fetch: authorizedFetch, refresh: refreshAccessToken }
): Promise<UserIdentity> {
  const client = createClient<paths>({ baseUrl: apiBaseUrl, fetch: auth.fetch });
  const createSession = () => client.POST('/v1/session', { headers: { Accept: 'application/json' } });
  let { data, error, response } = await createSession();
  if (response.status === 401) {
    await auth.refresh();
    ({ data, error, response } = await createSession());
  }
  if (!data) {
    const detail = error && typeof error === 'object' && 'error' in error && typeof error.error === 'string'
      ? ` ${error.error}`
      : '';
    throw new Error(`Account setup failed (${response.status}).${detail}`);
  }
  return data;
}
