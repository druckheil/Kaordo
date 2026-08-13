import type { AdminDashboard, CloudflareUsage } from '../domain/admin';

export interface AdminGateway {
  cloudflare(): Promise<CloudflareUsage | null>;
  dashboard(): Promise<AdminDashboard>;
}
