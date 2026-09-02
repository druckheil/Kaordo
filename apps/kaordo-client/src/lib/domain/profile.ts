export type ProfileAccent = 'mint' | 'ocean' | 'sunset' | 'violet';

export type ProfilePointer = {
  allocationId: string;
  avatarFileId: string | null;
  avatarMimeType: string | null;
  avatarSize: number;
  /** Optional while reading pointers created before profile banners existed. */
  bannerFileId?: string | null;
  bannerMimeType?: string | null;
  bannerSize?: number;
  nodeId: string;
  profileFileId: string;
  profileSize: number;
  updatedAt: number;
};

export type UserProfile = {
  accentColor?: ProfileAccent | null;
  avatarMimeType: string | null;
  avatarSize: number;
  avatarUrl: string | null;
  bannerMimeType?: string | null;
  bannerSize?: number;
  bannerUrl?: string | null;
  description: string;
  headline?: string;
  location?: string;
  nickname: string;
  nodeId: string;
  pronouns?: string;
  status?: string;
  updatedAt: number;
  website?: string;
};

export type ProfileSaveInput = {
  accentColor?: ProfileAccent | null;
  avatar: Blob | null | undefined;
  banner?: Blob | null;
  description: string;
  headline?: string;
  location?: string;
  nickname: string;
  nodeId: string;
  previous: ProfilePointer | null;
  pronouns?: string;
  status?: string;
  website?: string;
};

export type ProfileSnapshot = {
  error: string | null;
  phase: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  profile: UserProfile | null;
};
