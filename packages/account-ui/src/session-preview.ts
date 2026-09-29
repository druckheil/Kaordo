import type { UserIdentity } from '@kaordo/contracts';

// Presentation only. A cached preview must never authorize API requests or private content.
export type AccountPreview = Pick<UserIdentity, 'id' | 'username' | 'displayName'>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SavedPreview = AccountPreview & { savedAt: number };

export const accountPreviewKey = 'kaordo:account-preview:v1';
const maxAgeMs = 60 * 60 * 1_000;

function browserStorage(): StorageLike | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

export function readAccountPreview(storage = browserStorage(), now = Date.now()): AccountPreview | null {
  try {
    const raw = storage?.getItem(accountPreviewKey);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedPreview>;
    if (!validText(saved.id) || !validText(saved.username) || !validText(saved.displayName) ||
        typeof saved.savedAt !== 'number' || now < saved.savedAt || now - saved.savedAt > maxAgeMs) {
      storage?.removeItem(accountPreviewKey);
      return null;
    }
    return { id: saved.id, username: saved.username, displayName: saved.displayName };
  } catch {
    try { storage?.removeItem(accountPreviewKey); } catch { /* Storage can be disabled. */ }
    return null;
  }
}

export function rememberAccountPreview(user: UserIdentity, storage = browserStorage(), now = Date.now()): void {
  if (!validText(user.id) || !validText(user.username) || !validText(user.displayName)) return;
  try {
    storage?.setItem(accountPreviewKey, JSON.stringify({
      id: user.id, username: user.username, displayName: user.displayName, savedAt: now
    } satisfies SavedPreview));
  } catch {
    // Storage can be disabled; authentication continues without a preview.
  }
}

export function clearAccountPreview(storage = browserStorage()): void {
  try { storage?.removeItem(accountPreviewKey); } catch { /* Storage can be disabled. */ }
}
