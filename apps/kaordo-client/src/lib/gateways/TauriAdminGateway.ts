import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { AdminDashboard, AdminModerationResult, CloudflareUsage } from '../domain/admin';
import type { TauriInvoke } from './TauriWorkspaceGateway';
import type { AdminGateway } from './AdminGateway';

export class TauriAdminGateway implements AdminGateway {
  readonly #invoke: TauriInvoke;

  constructor(invoke: TauriInvoke = tauriInvoke) {
    this.#invoke = invoke;
  }

  cloudflare(forceRefresh = false): Promise<CloudflareUsage | null> {
    return this.#invoke<CloudflareUsage | null>(
      'admin_cloudflare',
      forceRefresh ? { forceRefresh: true } : undefined,
    );
  }

  dashboard(forceRefresh = false): Promise<AdminDashboard> {
    return this.#invoke<AdminDashboard>(
      'admin_dashboard',
      forceRefresh ? { forceRefresh: true } : undefined,
    );
  }

  banUser(userId: string): Promise<AdminModerationResult> {
    return this.#invoke<AdminModerationResult>('admin_ban_user', { userId });
  }

  unbanUser(userId: string): Promise<AdminModerationResult> {
    return this.#invoke<AdminModerationResult>('admin_unban_user', { userId });
  }

  eraseUser(userId: string): Promise<AdminModerationResult> {
    return this.#invoke<AdminModerationResult>('admin_erase_user', { userId });
  }
}
