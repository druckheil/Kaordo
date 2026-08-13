import type { AdminDashboard, CloudflareUsage } from '../domain/admin';
import type { AdminGateway } from '../gateways/AdminGateway';
import { GState } from '../state/GState';

export type RegadoSnapshot = {
  cloudflare: CloudflareUsage | null;
  cloudflareError: string | null;
  cloudflarePhase: 'idle' | 'loading' | 'ready' | 'error';
  dashboard: AdminDashboard | null;
  error: string | null;
  phase: 'idle' | 'loading' | 'ready';
};

export class RegadoGState extends GState<RegadoSnapshot> {
  readonly #gateway: AdminGateway;
  #requestId = 0;

  constructor(gateway: AdminGateway) {
    super({
      cloudflare: null,
      cloudflareError: null,
      cloudflarePhase: 'idle',
      dashboard: null,
      error: null,
      phase: 'idle',
    });
    this.#gateway = gateway;
  }

  override enter(): void {
    if (this.snapshot.phase === 'idle') void this.refresh();
  }

  override exit(): void {
    this.#requestId += 1;
  }

  async refresh(): Promise<void> {
    const requestId = ++this.#requestId;
    this.publish({
      ...this.snapshot,
      cloudflareError: null,
      cloudflarePhase: 'loading',
      error: null,
      phase: 'loading',
    });
    void this.#refreshCloudflare(requestId);
    try {
      const dashboard = await this.#gateway.dashboard();
      if (requestId !== this.#requestId) return;
      this.publish({ ...this.snapshot, dashboard, error: null, phase: 'ready' });
    } catch (error) {
      if (requestId !== this.#requestId) return;
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : 'The administration service is unavailable.';
      this.publish({ ...this.snapshot, error: message, phase: 'ready' });
    }
  }

  async #refreshCloudflare(requestId: number): Promise<void> {
    try {
      const cloudflare = await this.#gateway.cloudflare();
      if (requestId !== this.#requestId) return;
      this.publish({
        ...this.snapshot,
        cloudflare,
        cloudflareError: cloudflare ? null : 'Cloudflare telemetry is unavailable.',
        cloudflarePhase: cloudflare ? 'ready' : 'error',
      });
    } catch (error) {
      if (requestId !== this.#requestId) return;
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : 'Cloudflare telemetry is unavailable.';
      this.publish({
        ...this.snapshot,
        cloudflareError: message,
        cloudflarePhase: 'error',
      });
    }
  }
}
