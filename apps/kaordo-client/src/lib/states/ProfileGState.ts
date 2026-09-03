import type { ProfilePointer, ProfileSaveInput, ProfileSnapshot, UserProfile } from '../domain/profile';
import type { ProfileGateway } from '../gateways/ProfileGateway';
import { GState } from '../state/GState';

const PROFILE_REFRESH_CACHE_MS = 2 * 60_000;

export class ProfileGState extends GState<ProfileSnapshot> {
  readonly #gateway: ProfileGateway;
  #pointer: ProfilePointer | null = null;
  #requestId = 0;
  #lastLoadedAt = 0;
  #refreshInFlight: Promise<void> | null = null;

  constructor(gateway: ProfileGateway) {
    super({ error: null, phase: 'idle', profile: null });
    this.#gateway = gateway;
  }

  override enter(): void {
    // Mi is revisited frequently while composing or browsing Fluo. Keep a
    // recent profile (including the valid "no profile yet" result) instead
    // of downloading the same pointer, JSON, avatar, and banner every time.
    if (
      this.snapshot.phase === 'ready' &&
      this.#lastLoadedAt > 0 &&
      Date.now() - this.#lastLoadedAt < PROFILE_REFRESH_CACHE_MS
    ) return;
    void this.refresh();
  }

  override exit(): void {
    this.#requestId += 1;
    this.#refreshInFlight = null;
  }

  reset(): void {
    this.#requestId += 1;
    this.#lastLoadedAt = 0;
    this.#refreshInFlight = null;
    this.#revokeProfileMedia(this.snapshot.profile);
    this.#pointer = null;
    this.publish({ error: null, phase: 'idle', profile: null });
  }

  setError(error: string): void {
    this.publish({ ...this.snapshot, error, phase: 'ready' });
  }

  async refresh(): Promise<void> {
    if (this.#refreshInFlight) return this.#refreshInFlight;
    const request = this.refreshInternal();
    const shared = request.finally(() => {
      if (this.#refreshInFlight === shared) this.#refreshInFlight = null;
    });
    this.#refreshInFlight = shared;
    return shared;
  }

  private async refreshInternal(): Promise<void> {
    const requestId = ++this.#requestId;
    this.publish({ ...this.snapshot, error: null, phase: 'loading' });
    try {
      const loaded = await this.#gateway.load();
      if (requestId !== this.#requestId) {
        this.#revokeProfileMedia(loaded?.profile ?? null);
        return;
      }
      this.#replaceProfileMedia(loaded?.profile ?? null);
      this.#pointer = loaded?.pointer ?? null;
      this.#lastLoadedAt = Date.now();
      this.publish({ error: null, phase: 'ready', profile: loaded?.profile ?? null });
    } catch (error) {
      if (requestId !== this.#requestId) return;
      this.publish({ ...this.snapshot, error: readableError(error), phase: 'error' });
    }
  }

  async save(
    input: Omit<ProfileSaveInput, 'nodeId' | 'previous'>,
    nodeId: string,
  ): Promise<boolean> {
    if (this.snapshot.phase === 'saving') return false;
    const requestId = ++this.#requestId;
    const currentAvatar = this.snapshot.profile?.avatarUrl ?? null;
    const currentBanner = this.snapshot.profile?.bannerUrl ?? null;
    this.publish({ ...this.snapshot, error: null, phase: 'saving' });
    try {
      const result = await this.#gateway.save({
        ...input,
        nodeId,
        previous: this.#pointer,
      });
      if (requestId !== this.#requestId) {
        this.#revokeProfileMedia(result.profile);
        return false;
      }
      const avatarUrl = result.profile.avatarUrl ?? (input.avatar === undefined ? currentAvatar : null);
      const bannerUrl = result.profile.bannerUrl ?? (input.banner === undefined ? currentBanner : null);
      if (avatarUrl !== currentAvatar) this.#revokeAvatar(currentAvatar);
      if (bannerUrl !== currentBanner) this.#revokeUrl(currentBanner);
      this.#pointer = result.commit.pointer;
      this.#lastLoadedAt = Date.now();
      this.publish({ error: null, phase: 'ready', profile: { ...result.profile, avatarUrl, bannerUrl } });
      return true;
    } catch (error) {
      if (requestId !== this.#requestId) return false;
      this.publish({ ...this.snapshot, error: readableError(error), phase: 'ready' });
      return false;
    }
  }

  #replaceProfileMedia(next: UserProfile | null): void {
    const current = this.snapshot.profile;
    if (next?.avatarUrl !== current?.avatarUrl) this.#revokeAvatar(current?.avatarUrl ?? null);
    if (next?.bannerUrl !== current?.bannerUrl) this.#revokeUrl(current?.bannerUrl ?? null);
  }

  #revokeProfileMedia(profile: UserProfile | null): void {
    this.#revokeAvatar(profile?.avatarUrl ?? null);
    this.#revokeUrl(profile?.bannerUrl ?? null);
  }

  #revokeAvatar(url: string | null): void {
    this.#revokeUrl(url);
  }

  #revokeUrl(url: string | null): void {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

function readableError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'Profile storage is unavailable.';
}
