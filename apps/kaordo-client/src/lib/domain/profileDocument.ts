import type { ProfileAccent } from './profile';

const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const BANNER_MAX_BYTES = 8 * 1024 * 1024;
const MAX_HEADLINE_LENGTH = 120;
const MAX_LOCATION_LENGTH = 80;
const MAX_PRONOUNS_LENGTH = 48;
const MAX_STATUS_LENGTH = 100;
const MAX_WEBSITE_LENGTH = 200;

export type StoredProfileMediaReference = {
  fileId: string;
  mimeType: string;
  size: number;
};

/**
 * The profile document is a small, additive payload stored on the owner's
 * Public Nodo. Optional fields keep documents written by older clients valid.
 */
export type StoredProfileDocument = {
  accentColor?: ProfileAccent | null;
  avatar: StoredProfileMediaReference | null;
  banner?: StoredProfileMediaReference | null;
  description: string;
  headline?: string;
  location?: string;
  nickname: string;
  pronouns?: string;
  status?: string;
  updatedAt: number;
  version: 1;
  website?: string;
};

/** Safely parses and bounds a profile document received from a Nodo. */
export function parseStoredProfileDocument(value: unknown): StoredProfileDocument | null {
  return isProfileDocument(value) ? value : null;
}

function isProfileDocument(value: unknown): value is StoredProfileDocument {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 &&
    typeof record.nickname === 'string' && record.nickname.length <= 64 &&
    typeof record.description === 'string' && record.description.length <= 280 &&
    Number.isFinite(record.updatedAt) &&
    validMediaReference(record.avatar, AVATAR_MAX_BYTES) &&
    validOptionalMediaReference(record.banner, BANNER_MAX_BYTES) &&
    validOptionalText(record.headline, MAX_HEADLINE_LENGTH) &&
    validOptionalText(record.location, MAX_LOCATION_LENGTH) &&
    validOptionalText(record.pronouns, MAX_PRONOUNS_LENGTH) &&
    validOptionalText(record.status, MAX_STATUS_LENGTH) &&
    validOptionalText(record.website, MAX_WEBSITE_LENGTH) &&
    validAccent(record.accentColor);
}

function validMediaReference(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): value is StoredProfileMediaReference | null {
  if (value === null) return true;
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.fileId === 'string' && record.fileId.length > 0 &&
    typeof record.mimeType === 'string' && record.mimeType.length <= 120 &&
    Number.isSafeInteger(record.size) &&
    (record.size as number) >= 0 && (record.size as number) <= maximum;
}

function validOptionalMediaReference(
  value: unknown,
  maximum: number,
): value is StoredProfileMediaReference | null | undefined {
  return value === undefined || validMediaReference(value, maximum);
}

function validOptionalText(value: unknown, maximum: number): value is string | undefined {
  return value === undefined || typeof value === 'string' && value.length <= maximum;
}

function validAccent(value: unknown): value is ProfileAccent | null | undefined {
  return value === undefined || value === null || value === 'mint' || value === 'ocean' ||
    value === 'sunset' || value === 'violet';
}
