import type {
  FluoAttachment,
  FluoAuthorProfile,
  FluoDraftAttachment,
  FluoQuote,
  FluoPost,
  FluoSpace,
} from '../domain/fluo';

export const PUBLIC_FLUO_DESTINATION = 'public';
export type { FluoSpace } from '../domain/fluo';

export type RemoteFluoAttachment = FluoAttachment & { blob?: Blob };
export type RemoteFluoPost = Omit<FluoPost, 'attachments' | 'liked'> & {
  attachments: RemoteFluoAttachment[];
};

/** The compact identity used by the coordinator to address a post. */
export type FluoLikeTarget = Pick<FluoPost, 'id' | 'nodeId' | 'space'>;

export type FluoLikeState = FluoLikeTarget & {
  liked: boolean;
  likeCount: number;
};

/** Coordinator-backed likes are optional for custom/test gateways. */
export interface FluoLikesGateway {
  listLikeStates(targets: readonly FluoLikeTarget[]): Promise<FluoLikeState[]>;
  setLike(target: FluoLikeTarget, liked: boolean): Promise<FluoLikeState>;
}

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

export type FluoFeedSpaceState = {
  postCount: number;
  stateHash: string | null;
};

export type FluoNodeFeedState = {
  nodeId: string;
  spaces: Record<FluoSpace, FluoFeedSpaceState>;
};

export type FluoMediaSource = { blob: Blob; streamUrl?: never } | { blob?: never; streamUrl: string };

export interface FluoGateway {
  resetSession?(): void;
  deletePost(nodeId: string, postId: string, space: 'private' | 'public'): Promise<void>;
  /** Optional for lightweight/test gateways; production gateways batch this lookup. */
  loadAuthorProfiles?(usernames: readonly string[]): Promise<FluoAuthorProfile[]>;
  listLikeStates?(targets: readonly FluoLikeTarget[]): Promise<FluoLikeState[]>;
  listFeedPage(
    nodeIds: readonly string[],
    cursor: string | null,
    limit: number,
  ): Promise<FluoFeedPage>;
  /**
   * Lists one author's posts across every downloadable Nodo space using the
   * same resumable feed session as the global timeline. Optional keeps
   * lightweight test gateways compatible.
   */
  listAuthorFeedPage?(
    author: string,
    nodeIds: readonly string[],
    cursor: string | null,
    limit: number,
  ): Promise<FluoFeedPage>;
  listFeedStates(nodeIds: readonly string[]): Promise<FluoNodeFeedState[]>;
  loadMedia(
    nodeId: string,
    space: 'private' | 'public',
    attachment: FluoAttachment,
  ): Promise<FluoMediaSource>;
  setLike?(target: FluoLikeTarget, liked: boolean): Promise<FluoLikeState>;
  publishPost(
    nodeId: string,
    body: string,
    attachments: readonly FluoDraftAttachment[],
    onProgress?: (progress: FluoUploadProgress) => void,
    quote?: FluoQuote,
  ): Promise<RemoteFluoPost>;
}
