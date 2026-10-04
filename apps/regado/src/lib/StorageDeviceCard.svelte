<script lang="ts">
 // Keeps physical devices stable while presenting their partition roles and connection details
 import type { AdminDisk, AdminLayoutReport, AdminMount } from "@kaordo/contracts";
 import { Button, HardDriveIcon, UsbIcon } from "@kaordo/ui";
 import ContextHelp from "./ContextHelp.svelte";
 import OperationProgress from "./OperationProgress.svelte";
 import { connectionLabel, deviceIdentity, devicePartitions, partitionRole } from "./storage-layout";
 import { formatBytes as bytes, formatDateTime as time } from "./regado-model";
 let { device, pools, report, busy, onManage }: {
  device: AdminDisk; pools: AdminMount[]; report?: AdminLayoutReport; busy: boolean;
  onManage: (device: AdminDisk) => void;
 } = $props();
 const parts = $derived(devicePartitions(device));
 const areas = $derived(parts.filter((part) => !part.bootKind));
 const boot = $derived(parts.filter((part) => part.bootKind));
 const segments = $derived([...parts.map((part) => ({ key: part.path, start: part.start ?? 0, size: part.size, role: part.bootKind ? "boot" : partitionRole(part, pools) })), ...(device.unallocated ?? []).map((region) => ({ key: `free:${region.start}`, start: region.start, size: region.size, role: "free" }))].sort((a, b) => a.start - b.start));
 function roleColor(role: string): string {
  if (role === "system") return "bg-sky-500";
  if (role === "storage") return "bg-primary";
  return "bg-muted-foreground/20";
 }
 function volumeLocation(part: AdminDisk): string {
  const pool = pools.find((item) => item.integrity?.members.includes(part.path));
  if (pool) return pool.path;
  return part.mountpoints.filter(Boolean).join(", ") || "Not mounted";
 }
</script>

<article class="min-w-0 rounded-2xl border border-border bg-background p-4 sm:p-5" aria-label={`Device ${device.path}`}>
 <div class="flex items-start justify-between gap-3">
  <div class="flex min-w-0 items-center gap-3">
   <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">{#if device.transport === "usb"}<UsbIcon class="size-5" />{:else}<HardDriveIcon class="size-5" />{/if}</span>
   <div class="min-w-0"><h3 class="truncate text-sm font-bold">{device.model || device.name}</h3><p class="mt-1 text-xs text-muted-foreground">{device.path} · {connectionLabel(device)}</p></div>
  </div>
  <div class="text-right"><p class="whitespace-nowrap text-sm font-semibold">{(device.size / 1e12).toFixed(2)} TB</p><p class="text-xs text-muted-foreground">{bytes(device.size)}</p></div>
 </div>
 <div class="mt-4 flex h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
  {#each segments as segment (segment.key)}<span class={roleColor(segment.role)} style:width={`${100 * segment.size / device.size}%`}></span>{/each}
 </div>
 <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
  <span class={`font-medium ${device.health?.state === "failed" || device.health?.state === "warning" ? "text-destructive" : "text-primary"}`}>{report?.state === "running" ? "Configuring" : device.storageState === "working" ? "Working" : device.storageState === "queued" ? "Setup pending" : "Ready to configure"}</span>
  <div class="flex items-center gap-1"><span>SMART {device.health?.state || "unavailable"}{device.health?.temperatureC !== null && device.health?.temperatureC !== undefined ? ` · ${device.health.temperatureC} °C` : ""}</span>
   <ContextHelp label={`device ${device.path}`}>
    <p>Serial: {device.serial || "Unavailable"}<br />WWN: {device.wwn || "Unavailable"}</p>
    <p>Connection: {connectionLabel(device)}. Bay numbers are shown only when supplied by hardware; a controller address is not a bay number.</p>
    {#if device.health}<p>{device.health.powerOnHours?.toLocaleString() ?? "—"} hours · reallocated {device.health.reallocatedSectors ?? "—"} · pending {device.health.pendingSectors ?? "—"} · uncorrectable {device.health.uncorrectableSectors ?? "—"}</p><p>Checked {time(device.health.checkedAt)}; refreshed every 5 minutes.</p>{/if}
   </ContextHelp>
  </div>
 </div>
 <ul class="mt-4 space-y-2" aria-label={`Partitions on ${device.path}`}>
  {#each areas as part (part.path)}
   {@const role = partitionRole(part, pools)}
   <li class="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-secondary/50 px-3 py-2.5">
    <div class="min-w-0"><p class="flex items-center gap-2 text-sm font-semibold"><span class={`size-2 rounded-full ${roleColor(role)}`}></span>{role === "system" ? "System" : role === "storage" ? "Storage" : "Unassigned"}{part.mountpoints.includes("/") ? " · NixOS" : ""}</p><p class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{part.path} · {part.fsType || "No filesystem"} · {volumeLocation(part)}</p></div>
    <span class="shrink-0 text-xs font-medium">{bytes(part.size)}</span>
   </li>
  {/each}
  {#each device.unallocated ?? [] as region (region.start)}
   <li class="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs"><span class="font-medium">Available to allocate</span><span>{bytes(region.size)}</span></li>
  {/each}
 </ul>
 {#if boot.length || (device.overheadBytes ?? 0) > 0}
  <details class="mt-3 text-xs text-muted-foreground">
   <summary class="cursor-pointer rounded-md py-2 focus-visible:outline-2 focus-visible:outline-ring">Boot and partition metadata</summary>
   <div class="space-y-1 pb-2">{#each boot as part (part.path)}<p>{part.bootKind} · {part.path} · {bytes(part.size)}</p>{/each}<p>{bytes(device.overheadBytes ?? 0)} alignment slack; GPT headers also occupy a few sectors. These are protected, not additional free volumes.</p></div>
  </details>
 {/if}
 {#if report?.state === "running"}<div class="mt-3"><OperationProgress label={report.stage} progress={report.progress} /></div>{/if}
 {#if report?.error}<p class="mt-3 text-xs text-destructive" role="alert">{report.error}</p>{/if}
 <div class="mt-4 flex flex-wrap gap-2">
  <Button variant="outline" size="sm" disabled={busy || report?.state === "running" || !deviceIdentity(device)} onclick={() => onManage(device)}>Manage partitions</Button>
 </div>
</article>
