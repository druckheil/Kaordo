import { loadAccountSnapshot } from '@kaordo/account-ui';
import type { UserIdentity } from '@kaordo/contracts';

export async function loadSession(): Promise<{ authenticated: boolean; user: UserIdentity | null; error: string | null }> {
  return loadAccountSnapshot(import.meta.env);
}
