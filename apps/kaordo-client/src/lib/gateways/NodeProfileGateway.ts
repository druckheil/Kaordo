import type {
  ProfileAccent,
  ProfilePointer,
  ProfileSaveInput,
  UserProfile,
} from '../domain/profile';
import type { FluoSpace } from './FluoGateway';
import type {
  ProfileApiGateway,
  ProfileCommitInput,
  ProfileGateway,
  ProfileReservation,
} from './ProfileGateway';
import { NodeFluoGateway, type NodoUploadFile } from './NodeFluoGateway';
import type { NodoGateway } from './NodoGateway';
import {
  parseStoredProfileDocument,
  type StoredProfileDocument,
  type StoredProfileMediaReference,
} from '../domain/profileDocument';

export {
  parseStoredProfileDocument,
  type StoredProfileDocument,
  type StoredProfileMediaReference,
} from '../domain/profileDocument';

const PROFILE_MAX_BYTES = 32 * 1024;
const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const BANNER_MAX_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = PROFILE_MAX_BYTES + AVATAR_MAX_BYTES + BANNER_MAX_BYTES;
const MAX_HEADLINE_LENGTH = 120;
const MAX_PRONOUNS_LENGTH = 48;
const MAX_LOCATION_LENGTH = 80;
const MAX_STATUS_LENGTH = 100;
const MAX_WEBSITE_LENGTH = 200;
const PROFILE_SPACE: FluoSpace = 'public';
const EMPTY_FILE_ID = '00000000-0000-4000-8000-000000000000';

type ProfileFields = {
  accentColor: ProfileAccent | null;
  description: string;
  headline: string;
  location: string;
  nickname: string;
  pronouns: string;
  status: string;
  website: string;
};

export class NodeProfileGateway implements ProfileGateway {
  readonly #files: NodeFluoGateway;

  constructor(
    nodes: NodoGateway,
    private readonly api: ProfileApiGateway,
  ) {
    this.#files = new NodeFluoGateway(nodes);
  }

  async load(): Promise<{ pointer: ProfilePointer; profile: UserProfile } | null> {
    const rawPointer = await this.api.get();
    if (!rawPointer) return null;
    const document = await this.readDocument(rawPointer);
    const pointer = normalizePointer(rawPointer, document);
    const [avatarUrl, bannerUrl] = await Promise.all([
      this.downloadMediaUrl(pointer.nodeId, pointer.avatarFileId, pointer.avatarMimeType),
      this.downloadMediaUrl(pointer.nodeId, pointer.bannerFileId ?? null, pointer.bannerMimeType ?? null),
    ]);
    return {
      pointer,
      profile: {
        accentColor: document.accentColor ?? null,
        avatarMimeType: pointer.avatarMimeType,
        avatarSize: pointer.avatarSize,
        avatarUrl,
        bannerMimeType: pointer.bannerMimeType ?? null,
        bannerSize: pointer.bannerSize ?? 0,
        bannerUrl,
        description: document.description,
        headline: document.headline ?? '',
        location: document.location ?? '',
        nickname: document.nickname,
        nodeId: pointer.nodeId,
        pronouns: document.pronouns ?? '',
        status: document.status ?? '',
        updatedAt: pointer.updatedAt,
        website: safeWebsite(document.website),
      },
    };
  }

  async save(input: ProfileSaveInput): Promise<{
    profile: UserProfile;
    commit: { pointer: ProfilePointer; previous: ProfilePointer | null };
  }> {
    const fields: ProfileFields = {
      accentColor: normalizeAccentColor(input.accentColor ?? null),
      description: normalizeDescription(input.description),
      headline: normalizeOptionalText(input.headline ?? '', MAX_HEADLINE_LENGTH, 'Headline'),
      location: normalizeOptionalText(input.location ?? '', MAX_LOCATION_LENGTH, 'Location'),
      nickname: normalizeNickname(input.nickname),
      pronouns: normalizeOptionalText(input.pronouns ?? '', MAX_PRONOUNS_LENGTH, 'Pronouns'),
      status: normalizeOptionalText(input.status ?? '', MAX_STATUS_LENGTH, 'Status'),
      website: normalizeWebsite(input.website ?? ''),
    };
    validateAvatar(input.avatar);
    validateBanner(input.banner);

    const existingAvatar = input.avatar === undefined && input.previous?.avatarFileId
      ? mediaReference(
          input.previous.avatarFileId,
          input.previous.avatarMimeType ?? 'application/octet-stream',
          input.previous.avatarSize,
        )
      : null;
    const existingBanner = input.banner === undefined && input.previous?.bannerFileId
      ? mediaReference(
          input.previous.bannerFileId,
          input.previous.bannerMimeType ?? 'application/octet-stream',
          input.previous.bannerSize ?? 0,
        )
      : null;
    const estimatedDocument = profileDocument(
      fields,
      input.avatar instanceof Blob
        ? mediaReference(EMPTY_FILE_ID, input.avatar.type || 'image/*', input.avatar.size)
        : existingAvatar,
      input.banner instanceof Blob
        ? mediaReference(EMPTY_FILE_ID, input.banner.type || 'image/*', input.banner.size)
        : existingBanner,
    );
    const avatarBytes = input.avatar instanceof Blob
      ? input.avatar.size
      : existingAvatar?.size ?? 0;
    const bannerBytes = input.banner instanceof Blob
      ? input.banner.size
      : existingBanner?.size ?? 0;
    const profileBytes = new TextEncoder().encode(JSON.stringify(estimatedDocument)).byteLength;
    const estimate = profileBytes + avatarBytes + bannerBytes;
    if (estimate > MAX_TOTAL_BYTES) throw new Error('The profile is too large.');

    const reservation = await this.api.reserve(input.nodeId, estimate);
    let avatarFileId: string | null = existingAvatar?.fileId ?? null;
    let avatarMimeType: string | null = existingAvatar?.mimeType ?? null;
    let avatarSize = existingAvatar?.size ?? 0;
    let bannerFileId: string | null = existingBanner?.fileId ?? null;
    let bannerMimeType: string | null = existingBanner?.mimeType ?? null;
    let bannerSize = existingBanner?.size ?? 0;
    let uploadedAvatar: string | null = null;
    let uploadedBanner: string | null = null;
    let profileFileId: string | null = null;

    try {
      if (input.avatar instanceof Blob) {
        const avatar = toUpload(input.avatar, 'profile-avatar');
        avatarFileId = await this.#files.uploadFile(
          input.nodeId,
          PROFILE_SPACE,
          avatar,
          reservation.reservationId,
        );
        avatarMimeType = avatar.mimeType;
        avatarSize = avatar.size;
        uploadedAvatar = avatarFileId;
      }
      if (input.banner instanceof Blob) {
        const banner = toUpload(input.banner, 'profile-banner');
        bannerFileId = await this.#files.uploadFile(
          input.nodeId,
          PROFILE_SPACE,
          banner,
          reservation.reservationId,
        );
        bannerMimeType = banner.mimeType;
        bannerSize = banner.size;
        uploadedBanner = bannerFileId;
      }

      const document = profileDocument(
        fields,
        avatarFileId
          ? mediaReference(avatarFileId, avatarMimeType ?? 'application/octet-stream', avatarSize)
          : null,
        bannerFileId
          ? mediaReference(bannerFileId, bannerMimeType ?? 'application/octet-stream', bannerSize)
          : null,
      );
      const profileBlob = new Blob([JSON.stringify(document)], { type: 'application/json' });
      if (profileBlob.size > PROFILE_MAX_BYTES) throw new Error('The profile text is too large.');
      profileFileId = await this.#files.uploadFile(
        input.nodeId,
        PROFILE_SPACE,
        {
          blob: profileBlob,
          mimeType: 'application/json',
          name: 'kaordo-profile.json',
          size: profileBlob.size,
        },
        reservation.reservationId,
      );
      const commitInput: ProfileCommitInput = {
        avatarFileId,
        avatarMimeType,
        avatarSize,
        bannerFileId,
        bannerMimeType,
        bannerSize,
        profileFileId,
        profileSize: profileBlob.size,
      };
      const commit = await this.api.commit(reservation.reservationId, commitInput);
      await this.deletePrevious(commit.previous, commit.pointer, input.nodeId);
      return {
        commit,
        profile: {
          ...fields,
          avatarMimeType,
          avatarSize,
          avatarUrl: input.avatar instanceof Blob ? URL.createObjectURL(input.avatar) : null,
          bannerMimeType,
          bannerSize,
          bannerUrl: input.banner instanceof Blob ? URL.createObjectURL(input.banner) : null,
          nodeId: commit.pointer.nodeId,
          updatedAt: commit.pointer.updatedAt,
        },
      };
    } catch (error) {
      // Cleanup is best-effort. Cancelling the reservation in parallel keeps
      // failed media uploads from holding public quota until expiry.
      await Promise.allSettled([
        uploadedAvatar
          ? this.#files.deleteFile(input.nodeId, PROFILE_SPACE, uploadedAvatar)
          : Promise.resolve(),
        uploadedBanner
          ? this.#files.deleteFile(input.nodeId, PROFILE_SPACE, uploadedBanner)
          : Promise.resolve(),
        profileFileId
          ? this.#files.deleteFile(input.nodeId, PROFILE_SPACE, profileFileId)
          : Promise.resolve(),
        this.api.cancel(reservation.reservationId),
      ]);
      throw error;
    }
  }

  private async readDocument(pointer: ProfilePointer): Promise<StoredProfileDocument> {
    const blob = await this.#files.downloadFile(
      pointer.nodeId,
      PROFILE_SPACE,
      pointer.profileFileId,
      'application/json',
    );
    if (blob.size > PROFILE_MAX_BYTES) throw new Error('The stored profile is too large.');
    const value: unknown = JSON.parse(await blob.text());
    const document = parseStoredProfileDocument(value);
    if (!document) throw new Error('The stored profile is invalid.');
    return document;
  }

  private async downloadMediaUrl(
    nodeId: string,
    fileId: string | null,
    mimeType: string | null,
  ): Promise<string | null> {
    if (!fileId) return null;
    try {
      const blob = await this.#files.downloadFile(
        nodeId,
        PROFILE_SPACE,
        fileId,
        mimeType ?? 'application/octet-stream',
      );
      return URL.createObjectURL(blob);
    } catch {
      // A profile remains useful when a stale optional media file is missing.
      return null;
    }
  }

  private async deletePrevious(
    previous: ProfilePointer | null,
    current: ProfilePointer,
    fallbackNodeId: string,
  ): Promise<void> {
    if (!previous) return;
    const nodeId = previous.nodeId || fallbackNodeId;
    const files = new Set<string>([previous.profileFileId]);
    if (previous.avatarFileId && previous.avatarFileId !== current.avatarFileId) {
      files.add(previous.avatarFileId);
    }
    if (previous.bannerFileId && previous.bannerFileId !== current.bannerFileId) {
      files.add(previous.bannerFileId);
    }
    await Promise.allSettled(
      [...files].map((fileId) => this.#files.deleteFile(nodeId, PROFILE_SPACE, fileId)),
    );
  }
}

function profileDocument(
  fields: ProfileFields,
  avatar: StoredProfileMediaReference | null,
  banner: StoredProfileMediaReference | null,
): StoredProfileDocument {
  return {
    ...fields,
    avatar,
    banner,
    updatedAt: Date.now(),
    version: 1,
  };
}

function normalizePointer(pointer: ProfilePointer, document: StoredProfileDocument): ProfilePointer {
  const avatar = document.avatar;
  const banner = document.banner ?? null;
  return {
    ...pointer,
    avatarFileId: pointer.avatarFileId ?? avatar?.fileId ?? null,
    avatarMimeType: pointer.avatarMimeType ?? avatar?.mimeType ?? null,
    avatarSize: pointer.avatarSize ?? avatar?.size ?? 0,
    bannerFileId: pointer.bannerFileId ?? banner?.fileId ?? null,
    bannerMimeType: pointer.bannerMimeType ?? banner?.mimeType ?? null,
    bannerSize: pointer.bannerSize ?? banner?.size ?? 0,
  };
}

function mediaReference(fileId: string, mimeType: string, size: number): StoredProfileMediaReference {
  return { fileId, mimeType, size };
}

function toUpload(blob: Blob, name: string): NodoUploadFile {
  return { blob, mimeType: blob.type || 'application/octet-stream', name, size: blob.size };
}

function normalizeNickname(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 64) {
    throw new Error('Nickname must be 1–64 characters.');
  }
  return normalized;
}

function normalizeDescription(value: string): string {
  const normalized = value.trim();
  if (normalized.length > 280) throw new Error('Description must be 280 characters or less.');
  return normalized;
}

function normalizeOptionalText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`${label} must be ${maximum} characters or less.`);
  return normalized;
}

function normalizeWebsite(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';
  if (normalized.length > MAX_WEBSITE_LENGTH) {
    throw new Error(`Website must be ${MAX_WEBSITE_LENGTH} characters or less.`);
  }
  const url = parseWebsite(normalized);
  if (!url) throw new Error('Website must start with https:// or http://.');
  return url.toString();
}

function safeWebsite(value: string | undefined): string {
  if (!value || value.length > MAX_WEBSITE_LENGTH) return '';
  return parseWebsite(value) ? value : '';
}

function parseWebsite(value: string): URL | null {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function normalizeAccentColor(value: ProfileAccent | null): ProfileAccent | null {
  return value === 'mint' || value === 'ocean' || value === 'sunset' || value === 'violet'
    ? value
    : null;
}

function validateAvatar(avatar: Blob | null | undefined): void {
  if (!(avatar instanceof Blob)) return;
  if (avatar.size > AVATAR_MAX_BYTES) throw new Error('Avatar must be 4 MB or smaller.');
  if (!avatar.type.startsWith('image/')) throw new Error('Avatar must be an image.');
}

function validateBanner(banner: Blob | null | undefined): void {
  if (!(banner instanceof Blob)) return;
  if (banner.size > BANNER_MAX_BYTES) throw new Error('Banner must be 8 MB or smaller.');
  if (!banner.type.startsWith('image/')) throw new Error('Banner must be an image.');
}
