// Derives presentation labels and initial allocations from discovered partition roles
import type { AdminDisk, AdminMount } from '@kaordo/contracts';

export const GiB = 2 ** 30;
export const MiB = 2 ** 20;

export function devicePartitions(device: AdminDisk): AdminDisk[] {
	return (device.children ?? []).flatMap((part) =>
		part.type === 'part' ? [part] : devicePartitions(part)
	);
}

export function partitionRole(part: AdminDisk, pools: AdminMount[]): string {
	if (part.role) return part.role;
	if (
		part.mountpoints.includes('/') ||
		part.partitionLabel === 'kaordo-system' ||
		part.fsType === 'swap'
	)
		return 'system';
	return pools.some((pool) => pool.integrity?.members.includes(part.path))
		? 'storage'
		: 'unassigned';
}

export function allocation(
	device: AdminDisk,
	pools: AdminMount[],
	withSystem = false,
	bootMode = 'bios'
) {
	const parts = devicePartitions(device).filter((part) => !part.bootKind);
	const sum = (role: string) =>
		parts
			.filter((part) => partitionRole(part, pools) === role)
			.reduce((total, part) => total + part.size, 0);
	const system = sum('system');
	const storage = sum('storage');
	const free = (device.unallocated ?? []).reduce((total, region) => total + region.size, 0);
	// A blank device needs aligned GPT boundaries; a System area also reserves boot metadata
	const metadata = 2 * MiB + (withSystem ? (bootMode === 'uefi' ? 512 : 2) * MiB : 0);
	const available = device.layoutAvailable
		? system + storage + free
		: Math.max(0, Math.floor((device.size - metadata) / MiB) * MiB);
	return { system, storage, free, available };
}

export function deviceIdentity(device: AdminDisk): string {
	if (device.wwn?.trim()) return `wwn:${device.wwn.trim()}`;
	if (device.serial?.trim()) return `serial:${device.serial.trim()}`;
	return '';
}

export function connectionLabel(device: AdminDisk): string {
	const transport = device.transport?.toUpperCase() || 'Block device';
	return device.address ? `${transport} · controller ${device.address}` : transport;
}
