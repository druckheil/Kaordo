import type { AdminDashboard, CloudflareUsage } from '../domain/admin';
import type { AdminGateway } from './AdminGateway';
import { requestJson } from './WebApiClient';

export class WebAdminGateway implements AdminGateway {
  cloudflare(): Promise<CloudflareUsage | null> {
    return requestJson('/api/admin/cloudflare', {}, ADMIN_UNAVAILABLE);
  }

  dashboard(): Promise<AdminDashboard> {
    return requestJson('/api/admin/dashboard', {}, ADMIN_UNAVAILABLE);
  }
}

const ADMIN_UNAVAILABLE = 'The administration service is unavailable.';
