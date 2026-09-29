import { authConfigFromEnv, initializeAuth } from '@kaordo/auth';
import { bootstrapIdentity } from '@kaordo/api-client';
import type { UserIdentity } from '@kaordo/contracts';
import { clearAccountPreview, rememberAccountPreview } from './session-preview.ts';

export interface AccountSnapshot {
  loading: boolean;
  authenticated: boolean;
  user: UserIdentity | null;
  error: string | null;
}

export const initialAccountSnapshot: AccountSnapshot = {
  loading: true,
  authenticated: false,
  user: null,
  error: null
};

type Dependencies = {
  initializeAuth: typeof initializeAuth;
  bootstrapIdentity: typeof bootstrapIdentity;
};

export async function loadAccountSnapshot(
  environment: Record<string, string | undefined>,
  dependencies: Dependencies = { initializeAuth, bootstrapIdentity }
): Promise<AccountSnapshot> {
  let authenticated = false;
  try {
    const session = await dependencies.initializeAuth(authConfigFromEnv(environment));
    authenticated = session.authenticated;
    if (!authenticated) {
      clearAccountPreview();
      return { loading: false, authenticated: false, user: null, error: null };
    }
    const apiUrl = environment.VITE_KAORDO_API_URL;
    if (!apiUrl) throw new Error('The API is not configured.');
    const user = await dependencies.bootstrapIdentity(apiUrl);
    rememberAccountPreview(user);
    return { loading: false, authenticated: true, user, error: null };
  } catch (cause) {
    return {
      loading: false,
      authenticated,
      user: null,
      error: cause instanceof Error ? cause.message : 'Could not check your account.'
    };
  }
}

export function createAccountSessionController(
  environment: Record<string, string | undefined>,
  dependencies: Dependencies = { initializeAuth, bootstrapIdentity }
) {
  let generation = 0;

  return {
    async refresh(publish: (snapshot: AccountSnapshot) => void): Promise<void> {
      const current = ++generation;
      publish({ loading: true, authenticated: false, user: null, error: null });
      const snapshot = await loadAccountSnapshot(environment, dependencies);
      if (current === generation) publish(snapshot);
    },
    dispose(): void { generation++; }
  };
}
