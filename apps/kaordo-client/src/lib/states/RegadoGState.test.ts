import { describe, expect, it } from 'vitest';
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
});
