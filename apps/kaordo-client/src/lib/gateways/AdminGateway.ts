import type { AdminDashboard, AdminModerationResult, AdminSeedResetResult, CloudflareUsage } from '../domain/admin';

export interface AdminGateway {
  cloudflare(forceRefresh?: boolean): Promise<CloudflareUsage | null>;
  dashboard(forceRefresh?: boolean): Promise<AdminDashboard>;
  banUser(userId: string): Promise<AdminModerationResult>;
  unbanUser(userId: string): Promise<AdminModerationResult>;
  eraseUser(userId: string): Promise<AdminModerationResult>;
  resetUserSeed(userId: string): Promise<AdminSeedResetResult>;
}
