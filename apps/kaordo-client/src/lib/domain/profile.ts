export type ProfilePointer = {
  allocationId: string;
  avatarFileId: string | null;
  avatarMimeType: string | null;
  avatarSize: number;
  nodeId: string;
  profileFileId: string;
  profileSize: number;
  updatedAt: number;
};

export type UserProfile = {
  avatarMimeType: string | null;
  avatarSize: number;
  avatarUrl: string | null;
  description: string;
  nickname: string;
  nodeId: string;
  updatedAt: number;
};

export type ProfileSaveInput = {
  avatar: Blob | null | undefined;
  description: string;
  nickname: string;
  nodeId: string;
  previous: ProfilePointer | null;
};

export type ProfileSnapshot = {
  error: string | null;
  phase: 'idle' | 'loading' | 'ready' | 'saving' | 'error';
  profile: UserProfile | null;
};
