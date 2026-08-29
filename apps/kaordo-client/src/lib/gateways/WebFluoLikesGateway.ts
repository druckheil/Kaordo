import type {
  FluoLikeState,
  FluoLikeTarget,
  FluoLikesGateway,
} from './FluoGateway';
import { requestJson } from './WebApiClient';

const LIKES_UNAVAILABLE = 'Fluo likes are unavailable.';
const LIKES_TIMEOUT_MILLISECONDS = 8_000;
type ApiFluoLikeState = Omit<FluoLikeState, 'id'> & { postId: string };
type ApiLikeStatesResponse = { likes: ApiFluoLikeState[] };

/** Coordinator transport for compact like metadata. Post payloads stay on Nodo. */
export class WebFluoLikesGateway implements FluoLikesGateway {
  async listLikeStates(targets: readonly FluoLikeTarget[]): Promise<FluoLikeState[]> {
    if (!targets.length) return [];
    const response = await requestJson<ApiLikeStatesResponse>(
      '/api/fluo/likes/query',
      {
        body: JSON.stringify({ posts: targets.map(toApiTarget) }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
      LIKES_UNAVAILABLE,
      LIKES_TIMEOUT_MILLISECONDS,
    );
    return response.likes.map(fromApiState);
  }

  setLike(target: FluoLikeTarget, liked: boolean): Promise<FluoLikeState> {
    return requestJson<ApiFluoLikeState>(
      '/api/fluo/likes',
      {
        body: JSON.stringify({ ...toApiTarget(target), liked }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      },
      LIKES_UNAVAILABLE,
      LIKES_TIMEOUT_MILLISECONDS,
    ).then(fromApiState);
  }
}

function toApiTarget(target: FluoLikeTarget): { nodeId: string; postId: string; space: FluoLikeTarget['space'] } {
  return { nodeId: target.nodeId, postId: target.id, space: target.space };
}

function fromApiState(state: ApiFluoLikeState): FluoLikeState {
  return {
    id: state.postId,
    liked: state.liked,
    likeCount: state.likeCount,
    nodeId: state.nodeId,
    space: state.space,
  };
}
