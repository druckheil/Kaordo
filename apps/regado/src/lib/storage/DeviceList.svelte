<script lang="ts">
	// Lists pool members, missing members and other devices with the changes each one allows
	import type { HostDevice, HostFacts } from '@kaordo/contracts';
	import { Button, HardDriveIcon, TriangleAlertIcon, UsbIcon } from '@kaordo/ui';
	import { formatBytes } from '../regado-model';
	import { classLabels, deviceLabel, eligibleForPool, healthLabel } from './storage-model';

	let {
		facts,
		disabled,
		onChange
	}: {
		facts: HostFacts;
		disabled: boolean;
		onChange: (intent: { add?: string; remove?: string }) => void;
	} = $props();

	const members = $derived(
		new Map(facts.pool.members.filter((m) => m.deviceId).map((m) => [m.deviceId, m]))
	);
	const missing = $derived(facts.pool.members.filter((member) => member.missing));
	const others = $derived(facts.devices.filter((device) => device.class !== 'pool'));
	const pooled = $derived(facts.devices.filter((device) => device.class === 'pool'));

	function blockedReason(device: HostDevice): string {
		if (device.class === 'unidentified')
			return 'This device has no stable identity, so it cannot be managed.';
		if (device.hostsSystem) return 'This device holds the operating system.';
		if (!eligibleForPool(device)) return 'Unmount this device before adding it.';
		return '';
	}

	function errorCount(id: string): number {
		const errors = members.get(id)?.errors;
		return errors
			? errors.write + errors.read + errors.flush + errors.corruption + errors.generation
			: 0;
	}
</script>

{#snippet deviceHeading(device: HostDevice)}
	<div class="flex min-w-0 items-start gap-3">
		{#if device.transport === 'usb'}<UsbIcon
				class="mt-0.5 size-5 shrink-0 text-muted-foreground"
			/>{:else}<HardDriveIcon class="mt-0.5 size-5 shrink-0 text-muted-foreground" />{/if}
		<div class="min-w-0">
			<p class="truncate font-medium">{device.model || device.id || device.path}</p>
			<p class="truncate text-sm text-muted-foreground">
				{formatBytes(device.size)}{device.serial ? ` · ${device.serial}` : ''} · {device.path}
			</p>
			<p
				class={`truncate text-sm ${device.health?.state === 'failed' || device.health?.state === 'warning' ? 'text-destructive' : 'text-muted-foreground'}`}
			>
				{healthLabel(device.health)}
			</p>
		</div>
	</div>
{/snippet}

<section
	class="rounded-[1.4rem] border border-border bg-card p-4 sm:p-6"
	aria-labelledby="devices-title"
>
	<h2 id="devices-title" class="text-lg font-semibold">Devices</h2>
	<ul class="mt-4 grid grid-cols-1 gap-3">
		{#each pooled as device (device.id)}
			{@const member = members.get(device.id)}
			<li class="rounded-2xl border border-border p-4" aria-label={deviceLabel(device)}>
				<div class="flex flex-wrap items-start justify-between gap-3">
					{@render deviceHeading(device)}
					<Button
						variant="outline"
						size="sm"
						disabled={disabled || device.hostsSystem}
						title={device.hostsSystem ? 'This device also holds the operating system.' : undefined}
						onclick={() => onChange({ remove: device.id })}>Remove from pool</Button
					>
				</div>
				<p class="mt-3 text-sm text-muted-foreground">
					{classLabels.pool}{member
						? ` · ${formatBytes(member.used)} allocated`
						: ''}{device.hostsSystem ? ' · also holds the operating system' : ''}
				</p>
				{#if errorCount(device.id) > 0}
					<p class="mt-2 flex items-center gap-2 text-sm text-destructive">
						<TriangleAlertIcon class="size-4" />{errorCount(device.id)} I/O or checksum errors recorded
					</p>
				{/if}
			</li>
		{/each}
		{#each missing as member (member.devid)}
			<li
				class="rounded-2xl border border-destructive/40 p-4"
				aria-label={`Missing device ${member.devid}`}
			>
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div class="flex items-center gap-3">
						<TriangleAlertIcon class="size-5 text-destructive" />
						<div>
							<p class="font-medium">Missing device {member.devid}</p>
							<p class="text-sm text-muted-foreground">
								Choose a new device to rebuild its copies, or drop it from the pool.
							</p>
						</div>
					</div>
					<Button variant="outline" size="sm" {disabled} onclick={() => onChange({})}
						>Replace…</Button
					>
				</div>
			</li>
		{/each}
		{#each others as device (device.id || device.path)}
			{@const reason = blockedReason(device)}
			<li
				class="rounded-2xl border border-dashed border-border p-4"
				aria-label={deviceLabel(device)}
			>
				<div class="flex flex-wrap items-start justify-between gap-3">
					{@render deviceHeading(device)}
					{#if !reason}
						<Button
							variant="outline"
							size="sm"
							{disabled}
							onclick={() => onChange({ add: device.id })}>Add to pool</Button
						>
					{/if}
				</div>
				<p class="mt-3 text-sm text-muted-foreground">
					{classLabels[device.class]}{reason ? ` · ${reason}` : ''}
				</p>
			</li>
		{/each}
	</ul>
</section>
