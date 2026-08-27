import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
  FluoLikeState,
  FluoLikeTarget,
  FluoLikesGateway,
} from './FluoGateway';
import type { TauriInvoke } from './TauriWorkspaceGateway';

type LikeStateResponse = Omit<FluoLikeState, 'id'> & { postId: string };
type LikeStatesResponse = { likes: LikeStateResponse[] };

export class TauriFluoLikesGateway implements FluoLikesGateway {
  readonly #invoke: TauriInvoke;

  constructor(invoke: TauriInvoke = tauriInvoke) {
    this.#invoke = invoke;
  }

  async listLikeStates(targets: readonly FluoLikeTarget[]): Promise<FluoLikeState[]> {
    if (!targets.length) return [];
    const response = await this.#invoke<LikeStatesResponse>('fluo_like_states', {
      posts: targets.map(toCommandTarget),
    });
    return response.likes.map(fromCommandState);
  }

  setLike(target: FluoLikeTarget, liked: boolean): Promise<FluoLikeState> {
    return this.#invoke<LikeStateResponse>('fluo_set_like', { ...toCommandTarget(target), liked })
      .then(fromCommandState);
  }
}

function toCommandTarget(target: FluoLikeTarget): { nodeId: string; postId: string; space: FluoLikeTarget['space'] } {
  return { nodeId: target.nodeId, postId: target.id, space: target.space };
}

function fromCommandState(state: LikeStateResponse): FluoLikeState {
  return {
    id: state.postId,
    liked: state.liked,
    likeCount: state.likeCount,
    nodeId: state.nodeId,
    space: state.space,
  };
}
