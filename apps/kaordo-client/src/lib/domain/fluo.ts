/** Limits shared by the Fluo composer, cache, gateways, and Nodo wire format. */
export const FLUO_MAX_POST_LENGTH = 5_000;
export const FLUO_MAX_ATTACHMENTS = 4;
export const FLUO_MAX_AUDIO_ATTACHMENTS = 5;
export const FLUO_MAX_TOTAL_ATTACHMENTS = FLUO_MAX_ATTACHMENTS + FLUO_MAX_AUDIO_ATTACHMENTS;

export type FluoSpace = 'private' | 'public';
export type FluoAttachmentKind = 'audio' | 'gif' | 'image' | 'video';

export type FluoAttachment = {
  height?: number;
  id: string;
  kind: FluoAttachmentKind;
  mimeType: string;
  name: string;
  size: number;
  loadState?: 'error' | 'idle' | 'loading' | 'ready';
  objectUrl?: boolean;
  url?: string;
  width?: number;
};

export type FluoDraftAttachment = FluoAttachment & { blob: Blob; url: string };

/**
 * Compact, immutable metadata stored with a quoted post. Payload bytes remain
 * on the original Nodo and are resolved through the original post identity.
 */
export type FluoQuote = {
  attachments: FluoAttachment[];
  author: string;
  body: string;
  createdAt: number;
  id: string;
  nodeId: string;
  space: FluoSpace;
};

/**
 * An author's public profile as rendered by Fluo. Media stays a direct,
 * short-lived Nodo stream URL; profile text is kept small and optional so a
 * missing profile never prevents a post from rendering.
 */
export type FluoAuthorProfile = {
  accentColor?: 'mint' | 'ocean' | 'sunset' | 'violet' | null;
  /** Stable immutable file identity used to reuse profile media across metadata refreshes. */
  avatarHash?: string | null;
  avatarUrl: string | null;
  /** Stable immutable file identity used to reuse profile media across metadata refreshes. */
  bannerHash?: string | null;
  bannerUrl: string | null;
  description: string;
  headline: string;
  location: string;
  nickname: string;
  pronouns: string;
  status: string;
  username: string;
  website: string;
};

export type FluoPost = {
  attachments: FluoAttachment[];
  author: string;
  body: string;
  createdAt: number;
  id: string;
  liked: boolean;
  likeCount?: number;
  likePending?: boolean;
  nodeId: string;
  quote?: FluoQuote;
  space: FluoSpace;
};

/** Identity sufficient to resolve media rendered outside the main timeline. */
export type FluoMediaOwner = Pick<FluoPost, 'id' | 'nodeId' | 'space'>;

export function fluoPostKey(post: Pick<FluoPost, 'id' | 'nodeId' | 'space'>): string {
  return `${post.space}:${post.nodeId}:${post.id}`;
}

/** Creates a wire-safe quote snapshot without local URLs or render state. */
export function createFluoQuote(post: FluoPost): FluoQuote {
  return {
    attachments: post.attachments.map(
      ({ loadState: _loadState, objectUrl: _objectUrl, url: _url, ...attachment }) => ({ ...attachment }),
    ),
    author: post.author,
    body: post.body,
    createdAt: post.createdAt,
    id: post.id,
    nodeId: post.nodeId,
    space: post.space,
  };
}
