// Stores only a short-lived visual account preview and never grants access

import type { UserIdentity } from '@kaordo/contracts';
export type AccountPreview = Pick<UserIdentity, 'id' | 'username' | 'displayName'>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SavedPreview = AccountPreview & { savedAt: number };

export const accountPreviewKey = 'kaordo:account-preview:v1';
const maxAgeMs = 60 * 60 * 1_000;

function browserStorage(): StorageLike | undefined {
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

function isValidText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

export function readAccountPreview(storage = browserStorage(), now = Date.now()): AccountPreview | null {
  try {
    const raw = storage?.getItem(accountPreviewKey);
    if (!raw) return null;

    const saved: unknown = JSON.parse(raw);
    if (!isSavedPreview(saved, now)) {
      removePreview(storage);
      return null;
    }

    return { id: saved.id, username: saved.username, displayName: saved.displayName };
  } catch {
    removePreview(storage);
    return null;
  }
}

export function rememberAccountPreview(user: UserIdentity, storage = browserStorage(), now = Date.now()): void {
  if (!isValidText(user.id) || !isValidText(user.username) || !isValidText(user.displayName)) return;

  try {
    storage?.setItem(accountPreviewKey, JSON.stringify({
      id: user.id, username: user.username, displayName: user.displayName, savedAt: now
    } satisfies SavedPreview));
  } catch {
    // Storage can be disabled; authentication continues without a preview.
  }
}

export function clearAccountPreview(storage = browserStorage()): void {
  removePreview(storage);
}

function isSavedPreview(value: unknown, now: number): value is SavedPreview {
  if (!isRecord(value)) return false;

  const { id, username, displayName, savedAt } = value;
  return isValidText(id) && isValidText(username) && isValidText(displayName) &&
    typeof savedAt === 'number' && now >= savedAt && now - savedAt <= maxAgeMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function removePreview(storage?: StorageLike): void {
  try {
    storage?.removeItem(accountPreviewKey);
  } catch {
    // Storage can be disabled.
  }
}
