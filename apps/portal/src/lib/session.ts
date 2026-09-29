import { authConfigFromEnv, initializeAuth } from '@kaordo/auth';
import { bootstrapIdentity } from '@kaordo/api-client';
import type { UserIdentity } from '@kaordo/contracts';

export async function loadSession(): Promise<{ authenticated: boolean; user: UserIdentity | null; error: string | null }> {
  let authenticated = false;
  try {
    const auth = await initializeAuth(authConfigFromEnv(import.meta.env));
    authenticated = auth.authenticated;
    if (!authenticated) return { authenticated: false, user: null, error: null };
    const apiUrl = import.meta.env.VITE_KAORDO_API_URL;
    if (!apiUrl) throw new Error('The API is not configured. Set VITE_KAORDO_API_URL.');
    return { authenticated, user: await bootstrapIdentity(apiUrl), error: null };
  } catch (error) {
    return { authenticated, user: null, error: error instanceof Error ? error.message : 'Authentication is unavailable.' };
  }
}
