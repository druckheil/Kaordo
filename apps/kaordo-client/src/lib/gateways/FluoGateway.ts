import type {
  FluoAttachment,
  FluoDraftAttachment,
  FluoPost,
} from '../states/FluoGState';

export const PUBLIC_FLUO_DESTINATION = 'public';

export type RemoteFluoAttachment = FluoAttachment & { blob?: Blob };
export type RemoteFluoPost = Omit<FluoPost, 'attachments' | 'liked'> & {
  attachments: RemoteFluoAttachment[];
};

export type FluoUploadProgress = {
  attachmentIndex: number;
  attachmentName: string;
  attachmentTotal: number;
  totalBytes: number;
  uploadedBytes: number;
};

export type FluoFeedPage = {
  cursor: string | null;
  hasMore: boolean;
  posts: RemoteFluoPost[];
};

export type FluoMediaSource = { blob: Blob; streamUrl?: never } | { blob?: never; streamUrl: string };

export interface FluoGateway {
  resetSession?(): void;
  deletePost(nodeId: string, postId: string, space: 'private' | 'public'): Promise<void>;
  listFeedPage(
    nodeIds: readonly string[],
    cursor: string | null,
    limit: number,
  ): Promise<FluoFeedPage>;
  loadMedia(
    nodeId: string,
    space: 'private' | 'public',
    attachment: FluoAttachment,
  ): Promise<FluoMediaSource>;
  publishPost(
    nodeId: string,
    body: string,
    attachments: readonly FluoDraftAttachment[],
    onProgress?: (progress: FluoUploadProgress) => void,
  ): Promise<RemoteFluoPost>;
}
