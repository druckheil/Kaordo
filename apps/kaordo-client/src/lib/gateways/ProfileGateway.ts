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

export type ProfileCommitInput = {
  avatarFileId: string | null;
  avatarMimeType: string | null;
  avatarSize: number;
  profileFileId: string;
  profileSize: number;
};

export interface ProfileApiGateway {
  get(): Promise<ProfilePointer | null>;
  reserve(nodeId: string, bytes: number): Promise<ProfileReservation>;
  commit(reservationId: string, input: ProfileCommitInput): Promise<ProfileCommit>;
  cancel(reservationId: string): Promise<void>;
}

export interface ProfileGateway {
  load(): Promise<{ pointer: ProfilePointer; profile: UserProfile } | null>;
  save(input: ProfileSaveInput): Promise<{ profile: UserProfile; commit: ProfileCommit }>;
}
