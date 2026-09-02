import type { ProfilePointer, ProfileSaveInput, ProfileSnapshot, UserProfile } from '../domain/profile';
import type { ProfileGateway } from '../gateways/ProfileGateway';
import { GState } from '../state/GState';

export class ProfileGState extends GState<ProfileSnapshot> {
  readonly #gateway: ProfileGateway;
  #pointer: ProfilePointer | null = null;
  #requestId = 0;

  constructor(gateway: ProfileGateway) {
    super({ error: null, phase: 'idle', profile: null });
    this.#gateway = gateway;
  }

  override enter(): void {
    void this.refresh();
  }

  override exit(): void {
    this.#requestId += 1;
  }

  reset(): void {
    this.#requestId += 1;
    this.#revokeProfileMedia(this.snapshot.profile);
    this.#pointer = null;
    this.publish({ error: null, phase: 'idle', profile: null });
  }

  setError(error: string): void {
    this.publish({ ...this.snapshot, error, phase: 'ready' });
  }

  async refresh(): Promise<void> {
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
