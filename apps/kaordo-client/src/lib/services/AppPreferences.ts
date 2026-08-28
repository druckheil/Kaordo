import {
  appSectionsFor,
  type AppSection,
} from '../domain/appSection';
import type { AuthUser } from '../domain/auth';

const STORAGE_KEY = 'kaordo.app.v1';
const STORAGE_VERSION = 1;

/** The first section shown when no navigation preference has been saved. */
export const DEFAULT_APP_SECTION: AppSection = 'fluo';

/** Reads the last section without letting corrupt browser storage break boot. */
export function loadLastSection(storage: Storage | null = browserStorage()): AppSection {
  if (!storage) return DEFAULT_APP_SECTION;
  try {
    const value: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null');
    if (!isRecord(value) || value.version !== STORAGE_VERSION || !isAppSection(value.lastSection)) {
      return DEFAULT_APP_SECTION;
    }
    return value.lastSection;
  } catch {
    return DEFAULT_APP_SECTION;
  }
}

/** Persists only the small navigation preference; failures are non-fatal. */
export function saveLastSection(section: AppSection, storage: Storage | null = browserStorage()): void {
  if (!storage || !isAppSection(section)) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ lastSection: section, version: STORAGE_VERSION }));
  } catch {
    // Private browsing and disabled storage must not prevent navigation.
  }
}

/** Keeps an admin-only section from being restored for an ordinary account. */
export function sectionForRole(section: AppSection, role: AuthUser['role']): AppSection {
  return appSectionsFor(role).some((candidate) => candidate.id === section)
    ? section
    : DEFAULT_APP_SECTION;
}

function isAppSection(value: unknown): value is AppSection {
  return value === 'agordoj' || value === 'fluo' || value === 'ilo' || value === 'klaro' ||
    value === 'ligo' || value === 'mi' || value === 'nodo' || value === 'regado' || value === 'rondo';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function browserStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}
