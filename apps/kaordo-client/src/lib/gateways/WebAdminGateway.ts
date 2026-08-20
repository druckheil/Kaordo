import type { AdminDashboard, CloudflareUsage } from '../domain/admin';
import type { AdminGateway } from './AdminGateway';
import { requestJson } from './WebApiClient';

export class WebAdminGateway implements AdminGateway {
  cloudflare(forceRefresh = false): Promise<CloudflareUsage | null> {
    return requestJson(adminPath('/api/admin/cloudflare', forceRefresh), requestInit(forceRefresh), ADMIN_UNAVAILABLE);
  }

  dashboard(forceRefresh = false): Promise<AdminDashboard> {
    return requestJson(adminPath('/api/admin/dashboard', forceRefresh), requestInit(forceRefresh), ADMIN_UNAVAILABLE);
  }
}

const ADMIN_UNAVAILABLE = 'The administration service is unavailable.';

function adminPath(path: string, forceRefresh: boolean): string {
  return forceRefresh ? `${path}?fresh=1` : path;
}

function requestInit(forceRefresh: boolean): RequestInit {
  return forceRefresh ? { cache: 'no-store' } : {};
}
