<script lang="ts">
 // Groups physical devices under their host and composes partition management and copy operations
 import type { AdminDisk, AdminLayoutRequest, AdminMetrics, AdminMount, AdminStoragePlan, AdminSummary, AdminSystem } from "@kaordo/contracts";
 import { ServerIcon, Progress } from "@kaordo/ui";
 import MetricChart from "./MetricChart.svelte";
 import NixOSStoragePanel from "./NixOSStoragePanel.svelte";
 import FileCopiesPanel from "./FileCopiesPanel.svelte";
 import StorageHelp from "./StorageHelp.svelte";
 import StorageDeviceCard from "./StorageDeviceCard.svelte";
 import StorageLayoutDialog from "./StorageLayoutDialog.svelte";
 import { formatBytes as bytes, storageDevices } from "./regado-model";
 let { system, summary, metrics, actionBusy, onCheckCopies, onRepairCopies, onPreviewLayout, onApplyLayout }: {
  system: AdminSystem | null; summary: AdminSummary | null; metrics: AdminMetrics | null; actionBusy: boolean;
  onCheckCopies: (path: string) => void; onRepairCopies: (path: string) => void;
  onPreviewLayout: (body: AdminLayoutRequest, signal: AbortSignal) => Promise<AdminStoragePlan>;
  onApplyLayout: (body: AdminLayoutRequest & { fingerprint: string; confirmation: string; reason: string }) => Promise<void>;
 } = $props();
 let selected = $state<AdminDisk | null>(null);
 const devices = $derived(storageDevices(system?.disks ?? []));
 const hardwareBytes = $derived(devices.reduce((sum, disk) => sum + disk.size, 0));
 const operationsBusy = $derived(actionBusy || system?.layoutReports?.some((report) => report.state === "running") || system?.replicationReports?.some((report) => report.state === "checking" || report.state === "repairing") || system?.mediaMaintenance?.state === "checking" || system?.mediaMaintenance?.state === "repairing");
 const pools = $derived.by(() => {
  const grouped = new Map<string, AdminMount>();
  for (const mount of system?.mounts ?? []) {
   if (mount.fsType === "btrfs" && mount.path !== "/") {
    const key = mount.integrity?.uuid || mount.source;
    if (!grouped.has(key)) grouped.set(key, mount);
   }
  }
  return [...grouped.values()];
 });
 function poolStatus(pool: AdminMount): string {
  const state = pool.integrity;
  if (!state) return "Health unavailable";
  if (state.balanceRunning) return "Updating allocation";
  if (state.devicesOnline < state.devicesExpected) return "Disk unavailable";
  return state.healthy ? "Mirrored · healthy" : "Needs attention";
 }
</script>

<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-4 sm:p-6" aria-label="Host storage devices">
 <div class="flex flex-wrap items-start justify-between gap-3">
  <div class="flex items-center gap-3"><ServerIcon class="size-6 text-primary" /><div><h2 class="text-lg font-bold">{system?.hostname || "Host"}</h2><p class="text-xs text-muted-foreground">Storage devices · {devices.length} detected</p></div></div>
  <div class="flex items-center gap-1"><p class="text-sm font-semibold">{(hardwareBytes / 1e12).toFixed(2)} TB physical</p><StorageHelp label="physical capacity"><p>Hardware capacity includes every physical disk, partition and replica. Decimal TB matches disk manufacturers; partition sizes are shown in GiB.</p><p>Device identity and its connection remain separate from partition roles. Only this connected host is discovered; remote NAS hosts require an agent or supported connection.</p></StorageHelp></div>
 </div>
 <div class="mt-5 grid gap-4 lg:grid-cols-2">
  {#each devices as device (device.path)}<StorageDeviceCard {device} {pools} report={system?.layoutReports?.find((report) => report.device === device.path)} busy={Boolean(operationsBusy)} onManage={(disk) => selected = disk} />{:else}<p class="text-sm text-muted-foreground">{system ? "No physical devices detected." : "Discovering devices…"}</p>{/each}
 </div>
</section>

<NixOSStoragePanel {system} />

{#each pools as pool (pool.integrity?.uuid || pool.source)}
 <section class="mt-6 rounded-[1.4rem] border border-border bg-card p-4 sm:p-6" aria-label={`Storage pool ${pool.path}`}>
  <div class="flex flex-wrap items-start justify-between gap-3">
   <div><h2 class="text-lg font-bold">Storage pool</h2><p class="mt-1 font-mono text-xs text-muted-foreground">{pool.path}</p></div>
   <div class="flex items-center gap-2"><span class={`text-xs font-semibold ${pool.integrity?.healthy ? "text-primary" : "text-muted-foreground"}`}>{poolStatus(pool)}</span><StorageHelp label="storage pool"><p>{pool.integrity?.devicesOnline ?? 0}/{pool.integrity?.devicesExpected ?? 0} devices online. Data: {pool.integrity?.dataProfile || "unknown"}; metadata: {pool.integrity?.metadataProfile || "unknown"}.</p><p>RAID1 places two copies on separate devices. This is protection against a disk failure, not an independent backup.</p><p>The unique capacity reflects duplication and filesystem overhead; it is not the sum of physical disk sizes.</p></StorageHelp></div>
  </div>
  <dl class="mt-4 grid gap-3 sm:grid-cols-3"><div><dt class="text-xs text-muted-foreground">Physical pool capacity</dt><dd class="mt-1 font-semibold">{bytes(pool.integrity?.physicalTotal)} · includes replicas</dd></div><div><dt class="text-xs text-muted-foreground">Unique usable capacity</dt><dd class="mt-1 font-semibold">{bytes(pool.total)}</dd></div><div><dt class="text-xs text-muted-foreground">Available for unique data</dt><dd class="mt-1 font-semibold">{bytes(pool.free)}</dd></div></dl>
  {#if pool.available}<div class="mt-4"><Progress value={pool.total > 0 ? 100 * pool.used / pool.total : 0} aria-label={`Used capacity in ${pool.path}`} /><p class="mt-2 text-xs text-muted-foreground">{bytes(pool.used)} used</p></div>{/if}
  <FileCopiesPanel {system} {pool} actionBusy={Boolean(operationsBusy)} onCheck={onCheckCopies} onRepair={onRepairCopies} />
 </section>
{/each}

<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-4 sm:p-6">
 <div class="flex items-center gap-1"><h2 class="text-lg font-bold">Application data</h2><StorageHelp label="application data"><p>Counts come from PostgreSQL. Filesystem usage also includes indexes, logs and temporary artifacts, so it can exceed referenced content size.</p></StorageHelp></div>
 <p class="mt-2 text-sm text-muted-foreground">{summary?.posts ?? "—"} posts · {summary?.messages ?? "—"} messages · {summary?.uploads ?? "—"} media objects · database {bytes(summary?.databaseBytes)}</p>
 <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">{#each summary?.mediaByKind ?? [] as usage (usage.kind)}<div class="rounded-xl bg-secondary/50 p-3"><p class="text-xs font-medium capitalize">{usage.kind === "image" ? "Photos" : usage.kind === "video" ? "Videos" : "Files"}</p><p class="mt-1 font-semibold">{bytes(usage.bytes)}</p><p class="text-xs text-muted-foreground">{usage.objects} objects</p></div>{/each}</div>
</section>
<div class="mt-6"><MetricChart title="Storage usage" points={metrics?.series.storagePercent ?? []} /></div>

{#if selected}{#key selected.path}<StorageLayoutDialog device={selected} {pools} bootMode={system?.host.bootMode} onClose={() => selected = null} onPreview={onPreviewLayout} onApply={onApplyLayout} />{/key}{/if}
