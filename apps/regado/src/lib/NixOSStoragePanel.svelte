<script lang="ts">
	// Shows the system partition, its physical disk, and compressed memory swap
	import ContextHelp from './ContextHelp.svelte';
	import type { AdminDisk, AdminSystem } from '@kaordo/contracts';
	import { formatBytes as bytes } from './regado-model';
	let { system }: { system: AdminSystem | null } = $props();
	const root = $derived(system?.mounts.find((mount) => mount.path === '/'));
	const physical = $derived(system?.disks.find((disk) => disk.systemDisk));
	const memorySwap = $derived(
		system?.swapDevices.filter((swap) => swap.kind === 'compressed RAM') ?? []
	);
	function systemVolume(disk: AdminDisk | undefined): AdminDisk | undefined {
		if (!disk) return;
		if (disk.path === root?.source) return disk;
		for (const child of disk.children ?? []) {
			const match = systemVolume(child);
			if (match) return match;
		}
	}
	const volume = $derived(systemVolume(physical));
</script>

<section
	class="mt-6 rounded-[1.4rem] border border-border bg-card p-6"
	aria-label="NixOS system storage"
>
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h2 class="text-lg font-bold">NixOS system</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				{system?.host.osName || 'NixOS'}
				{system?.host.osVersion || ''} · system partition mounted at /
			</p>
		</div>
		<ContextHelp label="NixOS system"
			><p>
				The running root filesystem belongs to the physical device shown here. Its partition has the
				System role.
			</p>
			<p>
				Compressed RAM swap uses memory, not a third physical disk. Existing application metadata
				currently remains in the mirrored application pool.
			</p></ContextHelp
		>
	</div>
	<dl class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<div>
			<dt class="text-xs text-muted-foreground">Physical disk</dt>
			<dd class="mt-1 font-semibold">{physical?.path || 'Discovering…'}</dd>
			<dd class="mt-1 text-xs break-words text-muted-foreground">
				{physical?.model || ''}{physical?.serial ? ` · ${physical.serial}` : ''}
			</dd>
		</div>
		<div>
			<dt class="text-xs text-muted-foreground">System partition</dt>
			<dd class="mt-1 font-semibold">{root?.source || '—'}</dd>
			<dd class="mt-1 text-xs text-muted-foreground">
				{volume?.label || 'Unlabelled'} · {root?.fsType || '—'} · {bytes(volume?.size)} allocated
			</dd>
		</div>
		<div>
			<dt class="text-xs text-muted-foreground">System filesystem</dt>
			<dd class="mt-1 font-semibold">{bytes(root?.used)} used</dd>
			<dd class="mt-1 text-xs text-muted-foreground">
				{bytes(root?.free)} available · {bytes(root?.total)} usable
			</dd>
		</div>
		<div>
			<dt class="text-xs text-muted-foreground">Kernel</dt>
			<dd class="mt-1 font-semibold break-words">{system?.host.kernel || '—'}</dd>
			<dd class="mt-1 text-xs text-muted-foreground">
				{system ? `${Math.floor(system.host.uptimeSeconds / 3600)} hours uptime` : '—'}
			</dd>
		</div>
	</dl>
	{#if memorySwap.length}
		<div class="mt-5 rounded-xl bg-muted p-4">
			<h3 class="text-sm font-semibold">Compressed RAM swap</h3>

			{#each memorySwap as swap (swap.path)}<p class="mt-2 text-xs">
					<span class="font-mono">{swap.name}</span> · {bytes(swap.used)} of {bytes(swap.size)} in use
				</p>{/each}
		</div>
	{/if}
</section>
