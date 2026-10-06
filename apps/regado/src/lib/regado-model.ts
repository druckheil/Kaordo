// Defines Regado navigation, administrator intents, and display formatting

import type { AdminApi } from '@kaordo/api-client';
import type { AdminDisk, AdminLogs, AdminMount, AdminSystem, AdminLogRetentionDays } from '@kaordo/contracts';

export const dashboardTabs = [
  'Overview',
  'Storage',
  'Logs',
  'Users',
  'Audit',
  'System'
] as const;

export type DashboardTab = (typeof dashboardTabs)[number];
export const metricsWindows = ['1h', '24h', '7d'] as const;
export type MetricsWindow = (typeof metricsWindows)[number];
export type ContentKind = 'posts' | 'messages';
export const logPriorities = [
  { value: 'all', label: 'All' },
  { value: '3', label: 'Errors' },
  { value: '4', label: 'Warnings' },
  { value: '6', label: 'Info' }
] as const;
export type LogPriority = (typeof logPriorities)[number]['value'];
export type AdminSystemAction = Parameters<AdminApi['action']>[0];
export const restartActions = {
  nodo: 'restart-nodo',
  livekit: 'restart-livekit',
  ddclient: 'restart-ddclient'
} as const;

export type RestartableService = keyof typeof restartActions;

export type AdminIntent =
  | { type: 'log-retention'; days: AdminLogRetentionDays; name: string }
  | { type: 'status'; id: string; name: string; disabled: boolean }
  | { type: 'role'; id: string; name: string; isAdmin: boolean }
  | { type: 'case'; id: string; name: string }
  | { type: 'action'; id: AdminSystemAction; name: string; target?: string; identity?: string; filesystem?: string; resumeSetup?: boolean };

export const logServices = [
  'kerno',
  'nodo',
  'keycloak',
  'postgresql',
  'caddy',
  'livekit',
  'ddclient',
  'prometheus',
  'prometheus-node-exporter',
  'regado-agent'
] as const;

export const logRetentionOptions = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'Size limit only' }
] as const satisfies readonly { days: AdminLogRetentionDays; label: string }[];

export function isRefreshableTab(tab: DashboardTab): boolean {
  return tab === 'Overview' || tab === 'Storage' || tab === 'System';
}

export function isRestartableService(service: string): service is RestartableService {
  return Object.hasOwn(restartActions, service);
}

export function storageDevices(disks: AdminDisk[]): AdminDisk[] {
  const result: AdminDisk[] = [];
  const visit = (device: AdminDisk) => {
    if (device.type === 'disk') result.push(device);
    for (const child of device.children ?? []) visit(child);
  };
  for (const disk of disks) visit(disk);
  return result;
}

export function fileCopySummary(system: AdminSystem | null, pool: AdminMount) {
  const report = system?.replicationReports?.find((item) => item.path === pool.path);
  if (!report?.checkedAt) return null;
  const total = report.files;
  const media = system?.mediaMaintenance;
  const containsMedia = !!media && (media.directory === pool.path || media.directory.startsWith(pool.path + '/'));
  const referencesFresh = !!media?.checkedAt && !!media.startedAt && !!report.startedAt &&
    Date.parse(media.startedAt) >= Date.parse(report.startedAt) && media.state === 'complete';
  const surplus = containsMedia && referencesFresh ? Math.min(total, media.surplusFiles) : 0;
  const unknownReferences = containsMedia && referencesFresh ? Math.min(total - surplus, media.unverifiedFiles) :
    containsMedia || !media ? total - surplus : 0;
  const remaining = total - surplus - unknownReferences;
  const verified = report.checksumState === 'passed';
  const duplicated = verified && report.duplication === 'duplicated' ? remaining : 0;
  const single = verified && report.duplication === 'single' ? remaining : 0;
  return { report, total, duplicated, single, surplus, unverified: total - duplicated - single - surplus };
}

export function formatBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let count = value;
  let unitIndex = 0;
  while (count >= 1024 && unitIndex < units.length - 1) {
    count /= 1024;
    unitIndex++;
  }

  return `${count.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export function formatLogTime(value: string): string {
  const microseconds = Number(value);
  if (!Number.isFinite(microseconds) || microseconds <= 0) return '—';

  return new Date(microseconds / 1000).toLocaleString();
}

export function filterLogs(logs: AdminLogs | null, priority: LogPriority, search: string) {
  const normalizedSearch = search.toLowerCase();
  return (logs?.items ?? []).filter((item) => {
    const matchesPriority = priority === 'all' || item.priority === priority;
    const matchesSearch = item.message.toLowerCase().includes(normalizedSearch);
    return matchesPriority && matchesSearch;
  });
}

export function minimumReasonLength(intent: AdminIntent | null): number {
  return intent?.type === 'case' ? 20 : 10;
}

export function intentDescription(intent: AdminIntent | null): string {
  switch (intent?.type) {
    case 'log-retention':
      return 'This changes retention for the entire host journal. Older archived logs may be permanently removed. The disk-space budget still applies. Your reason is recorded before execution.';
    case 'case':
      return 'This opens a 15-minute access case, records the reason and notifies the account in Ligo Saved messages.';
    case 'status':
      return 'This changes account access immediately and records your reason.';
    case 'role':
      return 'Administrators can inspect account content and control services. This role change is recorded with your reason.';
    case 'action':
      if (intent.id === 'restart-ddclient') {
        return 'This runs one DNS check and starts the automatic update timer if necessary. The updater exits after each check; a scheduled idle service is healthy.';
      }
      if (intent.id === 'repair-storage') {
        return 'This restores two-copy Btrfs allocation on separate disks, repairs damaged blocks from valid copies, and removes only uploads older than 24 hours that Kerno confirms have no references. Fresh uploads, referenced files and surviving copies are retained. Progress appears in File copies.';
      }
      if (intent.id === 'check-storage') {
        return 'This scans checksummed data and metadata on every pool disk, counts regular files, and checks expired upload references. It does not delete files. Progress appears in File copies.';
      }
      if (intent.id === 'configure-storage') {
        if (intent.resumeSetup) {
          return 'This resumes the prepared Kaordo data partition and adds it to the selected Btrfs pool. The agent rechecks the hardware identity and partition before proceeding.';
        }
        return 'This prepares the selected empty disk and adds it to the Btrfs pool. The agent rechecks the hardware identity and refuses system disks, existing partitions, mounted filesystems, active swap, or filesystem signatures.';
      }
      return 'This system operation is recorded in the administrator audit.';
    default:
      return '';
  }
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The request failed.';
}
