import { describe, expect, it, vi } from 'vitest';
import type { AdminDashboard, CloudflareUsage } from '../domain/admin';
import type { AdminGateway } from '../gateways/AdminGateway';
import { RegadoGState } from './RegadoGState';

describe('RegadoGState', () => {
  it('publishes the dashboard without waiting for Cloudflare telemetry', async () => {
    let resolveCloudflare: (usage: CloudflareUsage | null) => void = () => undefined;
    const telemetry = new Promise<CloudflareUsage | null>((resolve) => {
      resolveCloudflare = resolve;
    });
    const dashboard = { generatedAt: 1 } as AdminDashboard;
    const gateway: AdminGateway = {
      cloudflare: () => telemetry,
      dashboard: () => Promise.resolve(dashboard),
      banUser: async () => ({ ok: true, status: 'suspended' }),
      unbanUser: async () => ({ ok: true, status: 'active' }),
      eraseUser: async () => ({ ok: true, status: 'erasing', pendingJobs: 1 }),
    };
    const state = new RegadoGState(gateway);

    await state.refresh();

    expect(state.snapshot).toMatchObject({
      cloudflare: null,
      cloudflarePhase: 'loading',
      dashboard,
      phase: 'ready',
    });

    const usage = { sampledAt: 2 } as CloudflareUsage;
    resolveCloudflare(usage);
    await telemetry;
    await Promise.resolve();

    expect(state.snapshot).toMatchObject({
      cloudflare: usage,
      cloudflarePhase: 'ready',
      dashboard,
    });
  });

  it('refreshes telemetry and dashboard independently with a force flag', async () => {
    const cloudflare = vi.fn(async () => ({ sampledAt: 2 } as CloudflareUsage));
    const dashboard = vi.fn(async () => ({ generatedAt: 2 } as AdminDashboard));
    const state = new RegadoGState({
      cloudflare,
      dashboard,
      banUser: async () => ({ ok: true, status: 'suspended' }),
      unbanUser: async () => ({ ok: true, status: 'active' }),
      eraseUser: async () => ({ ok: true, status: 'erasing', pendingJobs: 1 }),
    });

    await state.refreshCloudflare();
    expect(cloudflare).toHaveBeenCalledWith(true);
    expect(dashboard).not.toHaveBeenCalled();

    await state.refreshDashboard();
    expect(dashboard).toHaveBeenCalledWith(true);
    expect(state.snapshot.dashboardLoading).toBe(false);
  });
});
