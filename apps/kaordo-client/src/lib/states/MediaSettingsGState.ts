import {
  DEFAULT_MEDIA_PREFERENCES,
  normalizeMediaPreferences,
  type MediaPreferences,
} from '../domain/mediaSettings';
import type { MediaSettingsGateway } from '../gateways/MediaSettingsGateway';
import { GState } from '../state/GState';

export type MediaSettingsSnapshot = MediaPreferences & { error: string | null };

export class MediaSettingsGState extends GState<MediaSettingsSnapshot> {
  #revision = 0;

  constructor(private readonly gateway: MediaSettingsGateway) {
    super({ ...gateway.load(), error: null });
  }

  setMicrophone(microphoneId: string): void {
    this.change({ microphoneId });
  }

  setMicrophoneVolume(microphoneVolume: number): void {
    this.change({ microphoneVolume });
  }

  setSpeaker(speakerId: string): void {
    this.change({ speakerId });
  }

  setSpeakerVolume(speakerVolume: number): void {
    this.change({ speakerVolume });
  }

  reset(): void {
    this.publish({ ...DEFAULT_MEDIA_PREFERENCES, error: null });
    void this.persist(this.snapshot);
  }

  private change(update: Partial<MediaPreferences>): void {
    const next = normalizeMediaPreferences({ ...this.snapshot, ...update });
    if (
      next.microphoneId === this.snapshot.microphoneId
      && next.microphoneVolume === this.snapshot.microphoneVolume
      && next.speakerId === this.snapshot.speakerId
      && next.speakerVolume === this.snapshot.speakerVolume
    ) return;
    this.publish({ ...next, error: null });
    void this.persist(this.snapshot);
  }

  private async persist(snapshot: Readonly<MediaSettingsSnapshot>): Promise<void> {
    const revision = ++this.#revision;
    try {
      await this.gateway.save({
        microphoneId: snapshot.microphoneId,
        microphoneVolume: snapshot.microphoneVolume,
        speakerId: snapshot.speakerId,
        speakerVolume: snapshot.speakerVolume,
      });
    } catch {
      if (revision === this.#revision) {
        this.publish({ ...this.snapshot, error: 'Audio and video settings could not be saved.' });
      }
    }
  }
}
