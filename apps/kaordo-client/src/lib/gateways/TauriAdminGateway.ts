import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { AdminDashboard, CloudflareUsage } from '../domain/admin';
import type { TauriInvoke } from './TauriWorkspaceGateway';
import type { AdminGateway } from './AdminGateway';

export class TauriAdminGateway implements AdminGateway {
  readonly #invoke: TauriInvoke;

  constructor(invoke: TauriInvoke = tauriInvoke) {
    this.#invoke = invoke;
  }

  cloudflare(): Promise<CloudflareUsage | null> {
    return this.#invoke<CloudflareUsage | null>('admin_cloudflare');
  }

  dashboard(): Promise<AdminDashboard> {
    return this.#invoke<AdminDashboard>('admin_dashboard');
  }
}
