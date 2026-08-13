import type {
  AppearancePreferences,
  AppScale,
  AppTheme,
  TextScale,
} from '../domain/appearance';
import type { AppearanceGateway } from '../gateways/AppearanceGateway';
import { GState } from '../state/GState';

export type AppearanceSnapshot = AppearancePreferences & {
  error: string | null;
};

export class AppearanceGState extends GState<AppearanceSnapshot> {
  readonly #gateway: AppearanceGateway;
  #revision = 0;

  constructor(gateway: AppearanceGateway) {
    super({ ...gateway.load(), error: null });
    this.#gateway = gateway;
  }

  override enter(): void {
    void this.#persist(this.snapshot);
  }

  setTheme(theme: AppTheme): void {
    this.#change({ ...this.snapshot, theme });
  }

  setScale(scale: AppScale): void {
    this.#change({ ...this.snapshot, scale });
  }

  setTextScale(textScale: TextScale): void {
    this.#change({ ...this.snapshot, textScale });
  }

  reset(): void {
    this.#change({ error: null, scale: 1, textScale: 1, theme: 'light' });
  }

  #change(snapshot: AppearanceSnapshot): void {
    if (
      snapshot.scale === this.snapshot.scale
      && snapshot.textScale === this.snapshot.textScale
      && snapshot.theme === this.snapshot.theme
    ) return;
    this.publish({ ...snapshot, error: null });
    void this.#persist(this.snapshot);
  }

  async #persist(snapshot: Readonly<AppearanceSnapshot>): Promise<void> {
    const revision = ++this.#revision;
    try {
      await this.#gateway.save({
        scale: snapshot.scale,
        textScale: snapshot.textScale,
        theme: snapshot.theme,
      });
    } catch {
      if (revision !== this.#revision) return;
      this.publish({ ...this.snapshot, error: 'Appearance settings could not be applied.' });
    }
  }
}
