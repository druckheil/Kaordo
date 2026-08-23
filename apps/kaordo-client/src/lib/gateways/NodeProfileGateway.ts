import type { ProfilePointer, ProfileSaveInput, UserProfile } from '../domain/profile';
import type { FluoSpace } from './FluoGateway';
import type { ProfileApiGateway, ProfileCommitInput, ProfileGateway, ProfileReservation } from './ProfileGateway';
import { NodeFluoGateway, type NodoUploadFile } from './NodeFluoGateway';
import type { NodoGateway } from './NodoGateway';

const PROFILE_MAX_BYTES = 32 * 1024;
const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const PROFILE_SPACE: FluoSpace = 'public';

type ProfileDocument = {
  avatar: { fileId: string; mimeType: string; size: number } | null;
  description: string;
  nickname: string;
  updatedAt: number;
  version: 1;
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
    const pointer = await this.api.get();
    if (!pointer) return null;
    const document = await this.readDocument(pointer);
    let avatarUrl: string | null = null;
    if (pointer.avatarFileId) {
      try {
        const avatar = await this.#files.downloadFile(
          pointer.nodeId,
          PROFILE_SPACE,
          pointer.avatarFileId,
          pointer.avatarMimeType ?? 'application/octet-stream',
        );
        avatarUrl = URL.createObjectURL(avatar);
      } catch {
        // A profile remains useful when a stale avatar is unavailable. The
        // next save removes the stale pointer and releases the old allocation.
      }
    }
    return {
      pointer,
      profile: {
        avatarMimeType: pointer.avatarMimeType,
        avatarSize: pointer.avatarSize,
        avatarUrl,
        description: document.description,
        nickname: document.nickname,
        nodeId: pointer.nodeId,
        updatedAt: pointer.updatedAt,
      },
    };
  }

  async save(input: ProfileSaveInput): Promise<{ profile: UserProfile; commit: { pointer: ProfilePointer; previous: ProfilePointer | null } }> {
    const nickname = normalizeNickname(input.nickname);
    const description = normalizeDescription(input.description);
    validateAvatar(input.avatar);
    const existingAvatar = input.avatar === undefined && input.previous?.avatarFileId
      ? {
          fileId: input.previous.avatarFileId,
          mimeType: input.previous.avatarMimeType ?? 'application/octet-stream',
          size: input.previous.avatarSize,
        }
      : null;
    const estimatedDocument = profileDocument(nickname, description, existingAvatar ?? {
      fileId: '00000000-0000-4000-8000-000000000000',
      mimeType: input.avatar instanceof Blob && input.avatar.type ? input.avatar.type : 'image/*',
      size: input.avatar?.size ?? 0,
    });
    const avatarBytes = input.avatar instanceof Blob ? input.avatar.size : (existingAvatar?.size ?? 0);
    const estimate = new TextEncoder().encode(JSON.stringify(estimatedDocument)).byteLength + avatarBytes;
    if (estimate > PROFILE_MAX_BYTES + AVATAR_MAX_BYTES) {
      throw new Error('The profile is too large.');
    }
    const reservation = await this.api.reserve(input.nodeId, estimate);
    let avatarFileId: string | null = existingAvatar?.fileId ?? null;
    let avatarMimeType: string | null = existingAvatar?.mimeType ?? null;
    let avatarSize = existingAvatar?.size ?? 0;
    let uploadedAvatar: string | null = null;
    let profileFileId: string | null = null;
    try {
      if (input.avatar instanceof Blob) {
        const avatar = toUpload(input.avatar, 'profile-avatar');
        avatarFileId = await this.#files.uploadFile(input.nodeId, PROFILE_SPACE, avatar, reservation.reservationId);
        avatarMimeType = avatar.mimeType;
        avatarSize = avatar.size;
        uploadedAvatar = avatarFileId;
      }
      const document = profileDocument(nickname, description, avatarFileId
        ? { fileId: avatarFileId, mimeType: avatarMimeType ?? 'application/octet-stream', size: avatarSize }
        : null);
      const profileBlob = new Blob([JSON.stringify(document)], { type: 'application/json' });
      if (profileBlob.size > PROFILE_MAX_BYTES) throw new Error('The profile text is too large.');
      profileFileId = await this.#files.uploadFile(input.nodeId, PROFILE_SPACE, {
        blob: profileBlob,
        mimeType: 'application/json',
        name: 'kaordo-profile.json',
        size: profileBlob.size,
      }, reservation.reservationId);
      const commit = await this.api.commit(reservation.reservationId, {
        avatarFileId,
        avatarMimeType,
        avatarSize,
        profileFileId,
        profileSize: profileBlob.size,
      });
      await this.deletePrevious(commit.previous, commit.pointer, input.nodeId);
      const avatarUrl = input.avatar instanceof Blob
        ? URL.createObjectURL(input.avatar)
        : null;
      return {
        commit,
        profile: {
          avatarMimeType,
          avatarSize,
          avatarUrl,
          description: document.description,
          nickname: document.nickname,
          nodeId: commit.pointer.nodeId,
          updatedAt: commit.pointer.updatedAt,
        },
      };
    } catch (error) {
      // Cleanup is best-effort, but it should not serialize three independent
      // network operations. Cancelling the reservation in parallel also
      // releases the D1 quota promptly when a direct Nodo write fails.
      await Promise.allSettled([
        uploadedAvatar
          ? this.#files.deleteFile(input.nodeId, PROFILE_SPACE, uploadedAvatar)
          : Promise.resolve(),
        profileFileId
          ? this.#files.deleteFile(input.nodeId, PROFILE_SPACE, profileFileId)
          : Promise.resolve(),
        this.api.cancel(reservation.reservationId),
      ]);
      throw error;
    }
  }

  private async readDocument(pointer: ProfilePointer): Promise<ProfileDocument> {
    const blob = await this.#files.downloadFile(pointer.nodeId, PROFILE_SPACE, pointer.profileFileId, 'application/json');
    if (blob.size > PROFILE_MAX_BYTES) throw new Error('The stored profile is too large.');
    const value: unknown = JSON.parse(await blob.text());
    if (!isProfileDocument(value)) throw new Error('The stored profile is invalid.');
    return value;
  }

  private async deletePrevious(
    previous: ProfilePointer | null,
    current: ProfilePointer,
    fallbackNodeId: string,
  ): Promise<void> {
    if (!previous) return;
    const nodeId = previous.nodeId || fallbackNodeId;
    const files = new Set<string>([previous.profileFileId]);
    if (previous.avatarFileId && previous.avatarFileId !== current.avatarFileId) files.add(previous.avatarFileId);
    await Promise.allSettled([...files].map((fileId) => this.#files.deleteFile(nodeId, PROFILE_SPACE, fileId)));
  }
}

function profileDocument(
  nickname: string,
  description: string,
  avatar: ProfileDocument['avatar'],
): ProfileDocument {
  return { avatar, description, nickname, updatedAt: Date.now(), version: 1 };
}

function toUpload(blob: Blob, name: string): NodoUploadFile {
  return { blob, mimeType: blob.type || 'application/octet-stream', name, size: blob.size };
}

function normalizeNickname(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 64) throw new Error('Nickname must be 1–64 characters.');
  return normalized;
}

function normalizeDescription(value: string): string {
  const normalized = value.trim();
  if (normalized.length > 280) throw new Error('Description must be 280 characters or less.');
  return normalized;
}

function validateAvatar(avatar: Blob | null | undefined): void {
  if (!(avatar instanceof Blob)) return;
  if (avatar.size > AVATAR_MAX_BYTES) throw new Error('Avatar must be 4 MB or smaller.');
  if (!avatar.type.startsWith('image/')) throw new Error('Avatar must be an image.');
}

function isProfileDocument(value: unknown): value is ProfileDocument {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const avatar = record.avatar;
  const validAvatar = avatar === null || (
    typeof avatar === 'object' && avatar !== null &&
    typeof (avatar as Record<string, unknown>).fileId === 'string' &&
    typeof (avatar as Record<string, unknown>).mimeType === 'string' &&
    Number.isSafeInteger((avatar as Record<string, unknown>).size)
  );
  return record.version === 1 && typeof record.nickname === 'string' &&
    typeof record.description === 'string' && Number.isFinite(record.updatedAt) && validAvatar;
}
