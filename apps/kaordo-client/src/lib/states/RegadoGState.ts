import type { AdminDashboard, AdminModerationResult, CloudflareUsage } from '../domain/admin';
import type { AdminGateway } from '../gateways/AdminGateway';
import { GState } from '../state/GState';

export type RegadoSnapshot = {
  cloudflare: CloudflareUsage | null;
  cloudflareError: string | null;
  cloudflarePhase: 'idle' | 'loading' | 'ready' | 'error';
  dashboard: AdminDashboard | null;
  dashboardLoading: boolean;
  error: string | null;
  phase: 'idle' | 'loading' | 'ready';
};

export class RegadoGState extends GState<RegadoSnapshot> {
  readonly #gateway: AdminGateway;
  #cloudflareRequestId = 0;
  #dashboardRequestId = 0;

  constructor(gateway: AdminGateway) {
    super({
      cloudflare: null,
      cloudflareError: null,
      cloudflarePhase: 'idle',
      dashboard: null,
      dashboardLoading: false,
      error: null,
      phase: 'idle',
    });
    this.#gateway = gateway;
  }

  override enter(): void {
    if (this.snapshot.phase === 'idle') void this.refresh(false);
  }

  override exit(): void {
    this.#cloudflareRequestId += 1;
    this.#dashboardRequestId += 1;
  }

  async refresh(forceRefresh = true): Promise<void> {
    void this.refreshCloudflare(forceRefresh);
    await this.refreshDashboard(forceRefresh);
  }

  async refreshDashboard(forceRefresh = true): Promise<void> {
    const requestId = ++this.#dashboardRequestId;
    this.publish({
      ...this.snapshot,
      dashboardLoading: true,
      error: null,
      phase: this.snapshot.dashboard ? 'ready' : 'loading',
    });
    try {
      const dashboard = await this.#gateway.dashboard(forceRefresh);
      if (requestId !== this.#dashboardRequestId) return;
      this.publish({
        ...this.snapshot,
        dashboard,
        dashboardLoading: false,
        error: null,
        phase: 'ready',
      });
    } catch (error) {
      if (requestId !== this.#dashboardRequestId) return;
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : 'The administration service is unavailable.';
      this.publish({
        ...this.snapshot,
        dashboardLoading: false,
        error: message,
        phase: 'ready',
      });
    }
  }

  async refreshCloudflare(forceRefresh = true): Promise<void> {
    const requestId = ++this.#cloudflareRequestId;
    this.publish({ ...this.snapshot, cloudflareError: null, cloudflarePhase: 'loading' });
    try {
      const cloudflare = await this.#gateway.cloudflare(forceRefresh);
      if (requestId !== this.#cloudflareRequestId) return;
      this.publish({
        ...this.snapshot,
        cloudflare,
        cloudflareError: cloudflare ? null : 'Cloudflare telemetry is unavailable.',
        cloudflarePhase: cloudflare ? 'ready' : 'error',
      });
    } catch (error) {
      if (requestId !== this.#cloudflareRequestId) return;
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

  async moderateUser(
    userId: string,
    action: 'ban' | 'unban' | 'erase',
  ): Promise<AdminModerationResult> {
    const result = action === 'ban'
      ? await this.#gateway.banUser(userId)
      : action === 'unban'
        ? await this.#gateway.unbanUser(userId)
        : await this.#gateway.eraseUser(userId);
    await this.refreshDashboard(true);
    return result;
  }
}
