// Resolves the signed-in identity and prevents stale session refreshes from publishing

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
  rememberPreview?: typeof rememberAccountPreview;
  clearPreview?: typeof clearAccountPreview;
};

const defaultDependencies: Dependencies = { initializeAuth, bootstrapIdentity };

export async function loadAccountSnapshot(
  environment: Record<string, string | undefined>,
  dependencies: Dependencies = defaultDependencies,
  signal?: AbortSignal
): Promise<AccountSnapshot> {
  let authenticated = false;
  try {
    signal?.throwIfAborted();
    const session = await dependencies.initializeAuth(authConfigFromEnv(environment));
    signal?.throwIfAborted();
    authenticated = session.authenticated;
    if (!session.authenticated) return completedSnapshot(false, null);

    const apiUrl = requireApiUrl(environment);
    const user = await dependencies.bootstrapIdentity(apiUrl, undefined, signal);
    return completedSnapshot(true, user);
  } catch (cause) {
    return failedSnapshot(cause, authenticated);
  }
}

function requireApiUrl(environment: Record<string, string | undefined>): string {
  const apiUrl = environment.VITE_KAORDO_API_URL;
  if (!apiUrl) throw new Error('The API is not configured.');
  return apiUrl;
}

function completedSnapshot(authenticated: boolean, user: UserIdentity | null): AccountSnapshot {
  return { loading: false, authenticated, user, error: null };
}

function failedSnapshot(cause: unknown, authenticated: boolean): AccountSnapshot {
  return {
    loading: false,
    authenticated,
    user: null,
    error: cause instanceof Error ? cause.message : 'Could not check your account.'
  };
}

export function createAccountSessionController(
  environment: Record<string, string | undefined>,
  dependencies: Dependencies = defaultDependencies
) {
  let generation = 0;
  let disposed = false;
  let pending: AbortController | undefined;
  const rememberPreview = dependencies.rememberPreview ?? rememberAccountPreview;
  const clearPreview = dependencies.clearPreview ?? clearAccountPreview;

  function isCurrent(request: number): boolean {
    return !disposed && request === generation;
  }

  function updatePreview(snapshot: AccountSnapshot): void {
    if (snapshot.user) rememberPreview(snapshot.user);
    else if (shouldClearPreview(snapshot)) clearPreview();
  }

  return {
    async refresh(publish: (snapshot: AccountSnapshot) => void): Promise<void> {
      if (disposed) return;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const request = ++generation;
      publish({ loading: true, authenticated: false, user: null, error: null });
      const snapshot = await loadAccountSnapshot(environment, dependencies, controller.signal);
      if (pending === controller) pending = undefined;
      if (!isCurrent(request)) return;

      updatePreview(snapshot);
      publish(snapshot);
    },
    cancelPending(): void {
      pending?.abort();
      pending = undefined;
      generation++;
    },
    dispose(): void {
      disposed = true;
      pending?.abort();
      pending = undefined;
      generation++;
    }
  };
}

function shouldClearPreview(snapshot: AccountSnapshot): boolean {
  return snapshot.authenticated || !snapshot.error;
}
