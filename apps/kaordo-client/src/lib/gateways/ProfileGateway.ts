import type { ProfilePointer, ProfileSaveInput, UserProfile } from '../domain/profile';

export type ProfileReservation = {
  expiresAt: number;
  nodeId: string;
  profileId: string;
  reservationId: string;
};

export type ProfileCommit = {
  pointer: ProfilePointer;
  previous: ProfilePointer | null;
};

/**
 * Public profile metadata is looked up in batches for Fluo authors. The
 * allocation id is intentionally omitted: it is only needed by the owner
 * while replacing their profile and is not part of the public directory.
 */
export type PublicProfilePointer = Omit<ProfilePointer, 'allocationId'> & {
  username: string;
};

export type ProfileCommitInput = {
  avatarFileId: string | null;
  avatarMimeType: string | null;
  avatarSize: number;
  bannerFileId?: string | null;
  bannerMimeType?: string | null;
  bannerSize?: number;
  profileFileId: string;
  profileSize: number;
};

export interface ProfileApiGateway {
  get(): Promise<ProfilePointer | null>;
  reserve(nodeId: string, bytes: number): Promise<ProfileReservation>;
  commit(reservationId: string, input: ProfileCommitInput): Promise<ProfileCommit>;
  cancel(reservationId: string): Promise<void>;
}

/** Coordinator access for the public profile directory. */
export interface ProfileDirectoryGateway {
  lookup(usernames: readonly string[]): Promise<PublicProfilePointer[]>;
}

export interface ProfileGateway {
  load(): Promise<{ pointer: ProfilePointer; profile: UserProfile } | null>;
  save(input: ProfileSaveInput): Promise<{ profile: UserProfile; commit: ProfileCommit }>;
}
