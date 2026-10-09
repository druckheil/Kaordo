// Turns host facts into the labels, capacity figures and health that the Storage view presents

import type {
	HostDevice,
	HostDeviceHealth,
	HostFacts,
	HostOperation,
	HostPool,
	HostState
} from '@kaordo/contracts';

export type DeviceClass = HostDevice['class'];

export const classLabels: Record<DeviceClass, string> = {
	pool: 'In the pool',
	backup: 'Backup target',
	blank: 'Empty',
	foreign: 'Has other data',
	unidentified: 'No stable identity'
};

const profileCopies: Record<string, number> = { single: 1, dup: 1, raid1: 2, raid1c3: 3 };

// Copies the profile keeps on separate devices; dup keeps two copies on one device
function copiesOf(profile: string | undefined): number {
	return profile ? (profileCopies[profile] ?? 1) : 1;
}

export function copiesLabel(profile: string | undefined): string {
	if (profile === 'dup') return 'two copies on one device';
	const copies = copiesOf(profile);
	return copies === 1 ? 'one copy' : `${copies} copies on separate devices`;
}

// Capacity as users experience it: stored data counts once, free space is usable space
export function usableCapacity(pool: HostPool): {
	stored: number;
	free: number;
	total: number;
	ratio: number;
} {
	const ratio = pool.dataRatio > 0 ? pool.dataRatio : 1;
	const stored = pool.used / ratio;
	const free = Math.max(0, pool.freeEstimated);
	return {
		stored,
		free,
		total: stored + free,
		ratio: Math.min(1, stored / Math.max(1, stored + free))
	};
}

export interface PoolHealth {
	level: 'healthy' | 'warning' | 'critical';
	summary: string;
	details: string[];
}

export function poolHealth(facts: HostFacts): PoolHealth {
	const { pool, desired } = facts;
	const details: string[] = [];
	const missing = pool.members.filter((member) => member.missing).length;
	if (missing > 0)
		details.push(
			`${missing === 1 ? 'A device is' : `${missing} devices are`} missing; data relies on the remaining copies.`
		);
	const errors = pool.members.filter(
		(member) =>
			member.errors.write +
				member.errors.read +
				member.errors.flush +
				member.errors.corruption +
				member.errors.generation >
			0
	);
	for (const member of errors)
		details.push(
			`${deviceName(facts, member.deviceId) || `Device ${member.devid}`} reported I/O or checksum errors.`
		);
	if (pool.dataProfiles.length > 1 || pool.metadataProfiles.length > 1)
		details.push('Some data still uses an old copy profile until the conversion finishes.');
	const pooled = facts.devices.filter((device) => device.class === 'pool');
	const failing = pooled.filter((device) => device.health?.state === 'failed');
	const wearing = pooled.filter((device) => device.health?.state === 'warning');
	for (const device of failing)
		details.push(`${deviceLabel(device)} failed its SMART self-assessment.`);
	for (const device of wearing)
		details.push(`${deviceLabel(device)} reports reallocated or unreadable sectors.`);
	const used = usableCapacity(pool).ratio * 100;
	const thresholds = desired.alerts;
	if (used >= thresholds.poolWarningPercent) details.push(`The pool is ${used.toFixed(0)}% full.`);

	const critical =
		missing > 0 ||
		errors.length > 0 ||
		failing.length > 0 ||
		used >= thresholds.poolCriticalPercent;
	if (critical) return { level: 'critical', summary: 'Needs attention', details };
	if (details.length > 0) return { level: 'warning', summary: 'Check soon', details };
	return { level: 'healthy', summary: 'Healthy', details };
}

// Identical models are common in a pool, so the serial tells devices apart
export function deviceLabel(device: HostDevice): string {
	if (!device.model) return device.id || device.path;
	return device.serial ? `${device.model} · ${device.serial}` : device.model;
}

function deviceName(facts: HostFacts, id: string): string {
	const device = facts.devices.find((item) => item.id === id);
	return device ? deviceLabel(device) : id;
}

// One line of SMART evidence; sleeping disks keep their last report, so standby means never read
export function healthLabel(health: HostDeviceHealth | null): string {
	if (!health) return 'SMART not read yet';
	const facts = [
		health.temperatureC === null ? '' : `${health.temperatureC} °C`,
		health.powerOnHours === null ? '' : `${health.powerOnHours.toLocaleString()} hours`
	].filter(Boolean);
	const verdict = {
		passed: 'SMART passed',
		warning: 'SMART warning',
		failed: 'SMART failed',
		standby: 'Asleep, not read yet',
		unavailable: 'SMART unavailable'
	}[health.state];
	return [verdict, ...facts].join(' · ');
}

// Devices an operator can add: not in the pool, identified, not mounted and not the system disk
export function eligibleForPool(device: HostDevice): boolean {
	return (
		device.class !== 'pool' &&
		device.class !== 'unidentified' &&
		!device.hostsSystem &&
		device.mountpoints.length === 0 &&
		device.partitions.every((part) => part.mountpoints.length === 0)
	);
}

// Copy choices that fit a device count, highest first
export function dataProfilesFor(devices: number): HostState['pool']['dataProfile'][] {
	if (devices >= 3) return ['raid1c3', 'raid1'];
	if (devices === 2) return ['raid1'];
	return ['single'];
}

export function activeOperation(operations: HostOperation[]): HostOperation | undefined {
	return operations.find((item) => item.state === 'running' || item.state === 'queued');
}

export function operationTitle(operation: HostOperation): string {
	switch (operation.kind) {
		case 'pool.apply':
			return `Apply desired state${operation.target ? ` (${operation.target})` : ''}`;
		default:
			return operation.kind;
	}
}

export function stageProgress(stage: HostOperation['stages'][number]): number | undefined {
	if (!stage.progress || stage.progress.total <= 0) return undefined;
	return Math.min(100, (stage.progress.done / stage.progress.total) * 100);
}
