<script lang="ts">
 // Reviews role allocations and confirms a server-validated plan before changing any partition
 import { onDestroy } from "svelte";
 import type { AdminDisk, AdminLayoutRequest, AdminMount, AdminStoragePlan } from "@kaordo/contracts";
 import { Button, Dialog, Input, LoaderCircleIcon } from "@kaordo/ui";
 import ContextHelp from "./ContextHelp.svelte";
 import { allocation, deviceIdentity, GiB, MiB } from "./storage-layout";
 import { errorMessage, formatBytes as bytes } from "./regado-model";
 let { device, pools, bootMode = "bios", onClose, onPreview, onApply }: {
  device: AdminDisk; pools: AdminMount[]; bootMode?: string; onClose: () => void;
  onPreview: (body: AdminLayoutRequest, signal: AbortSignal) => Promise<AdminStoragePlan>;
  onApply: (body: AdminLayoutRequest & { fingerprint: string; confirmation: string; reason: string }) => Promise<void>;
 } = $props();
 function initialAllocation() { return allocation(device, pools, false, bootMode); }
 function initialPool() { return pools.find((pool) => pool.integrity?.members.some((member) => device.children?.some((part) => part.path === member)))?.path || pools[0]?.path || ""; }
 let systemSize = $state<number | undefined>(initialAllocation().system / GiB);
 let storageSize = $state<number | undefined>((initialAllocation().storage || (initialAllocation().available - initialAllocation().system)) / GiB);
 let filesystem = $state(initialPool());
 const current = $derived(allocation(device, pools, Number(systemSize) > 0, bootMode));
 let plan = $state<AdminStoragePlan | null>(null);
 let reviewed = $state<AdminLayoutRequest | null>(null);
 let confirmation = $state("");
 let reason = $state("");
 let busy = $state(false);
 let applying = $state(false);
 let error = $state("");
 let pending: AbortController | null = null;
 const allocated = $derived((Number(systemSize) + Number(storageSize)) * GiB);
 const valid = $derived(Number.isFinite(allocated) && Number(systemSize) >= 0 && Number(storageSize) >= 0 && allocated > 0 && allocated <= current.available && (!Number(storageSize) || filesystem));
 onDestroy(() => pending?.abort());
 function invalidate(): void { pending?.abort(); pending = null; plan = null; reviewed = null; confirmation = ""; busy = false; error = ""; }
 function preset(role: "system" | "storage"): void {
  invalidate();
  const capacity = allocation(device, pools, role === "system", bootMode).available;
  systemSize = role === "system" ? capacity / GiB : 0; storageSize = role === "storage" ? capacity / GiB : 0;
 }
 async function preview(): Promise<void> {
  if (!valid || busy) return;
  invalidate();
  const controller = new AbortController(); pending = controller; busy = true;
  const body: AdminLayoutRequest = { device: device.path, identity: deviceIdentity(device), filesystem, systemBytes: Math.floor(Number(systemSize) * GiB / MiB) * MiB, storageBytes: Math.floor(Number(storageSize) * GiB / MiB) * MiB };
  try {
   const result = await onPreview(body, controller.signal);
   if (pending !== controller || controller.signal.aborted) return;
   reviewed = body; plan = result;
  } catch (cause) { if (!controller.signal.aborted) error = errorMessage(cause); }
  finally { if (pending === controller) { busy = false; pending = null; } }
 }
 async function apply(): Promise<void> {
  if (!plan?.supported || !reviewed || applying || confirmation !== device.path || reason.trim().length < 10) return;
  applying = true; error = "";
  try { await onApply({ ...reviewed, fingerprint: plan.fingerprint, confirmation, reason: reason.trim() }); onClose(); }
  catch (cause) { error = errorMessage(cause); }
  finally { applying = false; }
 }
 function downloadDeclaration(): void {
  if (!plan) return;
  const url = URL.createObjectURL(new Blob([plan.declaration], { type: "text/plain" }));
  const link = document.createElement("a"); link.href = url; link.download = "kaordo-disko.nix"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
 }
</script>

<Dialog.Root open onOpenChange={(open) => { if (!open && !applying) onClose(); }}>
 <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl" onEscapeKeydown={(event) => { if (applying) event.preventDefault(); }}>
  <Dialog.Header><Dialog.Title>Manage partitions</Dialog.Title><Dialog.Description>{device.model || device.name} · {device.path} · {bytes(current.available)} allocatable</Dialog.Description></Dialog.Header>
  <div class="space-y-4">
   <div class="flex flex-wrap items-center gap-2"><Button size="xs" variant="outline" disabled={busy || applying} onclick={() => preset("storage")}>Storage 100%</Button><Button size="xs" variant="outline" disabled={busy || applying} onclick={() => preset("system")}>System 100%</Button><ContextHelp label="partition allocation"><p>Roles belong to partitions, not disks. System holds operating-system or service data; Storage joins the selected file pool. All sizes here are GiB (1 GiB = 1.074 GB).</p><p>GPT and boot metadata are reserved separately. New System volumes are prepared for data; another NixOS installation requires its own installation workflow.</p><p>Live partition starts never move. An existing System filesystem or a partition containing data may require offline migration.</p></ContextHelp></div>
   <div class="grid grid-cols-2 gap-3">
    <label class="space-y-2 text-sm font-medium">System · GiB<Input type="number" min="0" step="any" bind:value={systemSize} oninput={invalidate} disabled={applying} /></label>
    <label class="space-y-2 text-sm font-medium">Storage · GiB<Input type="number" min="0" step="any" bind:value={storageSize} oninput={invalidate} disabled={applying} /></label>
   </div>
   <p class={`text-xs ${allocated > current.available ? "text-destructive" : "text-muted-foreground"}`}>{Number.isFinite(allocated) ? `${bytes(Math.max(0, current.available - allocated))} left unassigned` : "Enter valid sizes"}</p>
   {#if Number(storageSize) > 0}<label class="block space-y-2 text-sm font-medium">Storage pool<select class="h-10 w-full rounded-xl border border-input bg-background px-3" bind:value={filesystem} onchange={invalidate} disabled={applying}>{#each pools as pool (pool.path)}<option value={pool.path}>{pool.path}</option>{/each}{#if !pools.length}<option value="">No managed pool available</option>{/if}</select></label>{/if}
   <Button variant="outline" disabled={!valid || busy || applying} onclick={() => void preview()}>{#if busy}<LoaderCircleIcon class="size-4 animate-spin" />{/if}Preview layout</Button>
   {#if plan}
    <div class="space-y-3 rounded-xl border border-border bg-secondary/40 p-4" aria-label="Reviewed layout">
     <p class="text-sm font-semibold">System {bytes(plan.systemBytes)} · Storage {bytes(plan.storageBytes)}</p>
     <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>Layout engine: {plan.backend}</span><Button variant="ghost" size="xs" onclick={downloadDeclaration}>Export Disko</Button></div>
     <ul class="space-y-1 text-xs text-muted-foreground">{#each plan.steps as step}<li class="capitalize">{step.kind === "boot" ? "Preserve boot support" : `${step.kind} ${step.role} · ${bytes(step.size)}`}</li>{/each}</ul>
     {#each plan.issues as issue}<p class="text-sm text-destructive">{issue}</p>{/each}
     {#each plan.warnings as warning}<p class="text-xs leading-5 text-muted-foreground">{warning}</p>{/each}
    </div>
    {#if plan.supported}
     <label class="block space-y-2 text-sm font-medium">Reason<Input bind:value={reason} minlength={10} maxlength={500} disabled={applying} placeholder="Why is this layout changing?" /></label>
     <label class="block space-y-2 text-sm font-medium">Type {device.path} to confirm<Input bind:value={confirmation} disabled={applying} autocomplete="off" /></label>
     <p class="text-xs text-muted-foreground">Changes start only after confirmation. The server rechecks device identity and partition geometry.</p>
    {/if}
   {/if}
   {#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
  </div>
  <Dialog.Footer><Button variant="outline" disabled={applying} onclick={onClose}>Cancel</Button><Button disabled={!plan?.supported || applying || confirmation !== device.path || reason.trim().length < 10} onclick={() => void apply()}>{#if applying}<LoaderCircleIcon class="size-4 animate-spin" />{/if}Apply layout</Button></Dialog.Footer>
 </Dialog.Content>
</Dialog.Root>
