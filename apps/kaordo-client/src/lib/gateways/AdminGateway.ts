import type { AdminDashboard, CloudflareUsage } from '../domain/admin';

export interface AdminGateway {
  cloudflare(forceRefresh?: boolean): Promise<CloudflareUsage | null>;
  dashboard(forceRefresh?: boolean): Promise<AdminDashboard>;
}
