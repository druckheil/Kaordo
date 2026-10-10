// Turns storage measurements into labelled shares, growth warnings and per-account findings

import type {
	AdminDataUsage,
	AdminUserData,
	HostUsage,
	HostUsageCategory
} from '@kaordo/contracts';

export type CategoryKey = HostUsageCategory['key'];
export type UsageWindow = '1d' | '7d' | '30d' | '90d';
export const usageWindows: UsageWindow[] = ['1d', '7d', '30d', '90d'];

// Medium-lightness colours stay distinct on light and dark themes; cool tones are the system,
// green the application's data and warm tones what accounts upload
export const categories: Record<
	CategoryKey,
	{ label: string; description: string; color: string; userDriven: boolean }
> = {
	media: {
		label: 'Uploaded files',
		description: 'Encrypted photos, videos and files that accounts uploaded.',
		color: 'oklch(0.74 0.16 65)',
		userDriven: true
	},
	database: {
		label: 'Database',
		description: 'Accounts, encrypted posts, messages and journals, and the identity service.',
		color: 'oklch(0.65 0.15 145)',
		userDriven: true
	},
	metrics: {
		label: 'Metrics',
		description: 'Prometheus history behind the charts.',
		color: 'oklch(0.72 0.13 175)',
		userDriven: false
	},
	releases: {
		label: 'App versions',
		description: 'The current release and earlier ones kept for rollback.',
		color: 'oklch(0.66 0.12 205)',
		userDriven: false
	},
	nix: {
		label: 'System packages',
		description: 'The Nix store: software of the current and previous system versions.',
		color: 'oklch(0.7 0.1 235)',
		userDriven: false
	},
	system: {
		label: 'Operating system',
		description: 'NixOS configuration, service state and the bootloader.',
		color: 'oklch(0.6 0.13 255)',
		userDriven: false
	},
	logs: {
		label: 'Logs',
		description: 'The journal of every service.',
		color: 'oklch(0.64 0.17 300)',
		userDriven: false
	},
	temporary: {
		label: 'Temporary files',
		description: 'Scratch space that services should clean up themselves.',
		color: 'oklch(0.68 0.16 345)',
		userDriven: false
	},
	other: {
		label: 'Other server data',
		description: 'Secrets, certificates and settings.',
		color: 'oklch(0.6 0.04 265)',
		userDriven: false
	},
	metadata: {
		label: 'Filesystem metadata',
		description:
			'Btrfs metadata and checksums that make every file verifiable, including small files kept inline.',
		color: 'oklch(0.55 0 0)',
		userDriven: false
	},
	unreferenced: {
		label: 'Unattributed pool usage',
		description:
			'Pool usage beyond counted file sizes and filesystem metadata. Its cause needs further investigation.',
		color: 'oklch(0.45 0.02 20)',
		userDriven: false
	}
};

export interface Segment {
	key: CategoryKey;
	label: string;
	color: string;
	bytes: number;
	share: number;
	growthDay: number | null;
	growthWeek: number | null;
	warning: string;
}

const mebibyte = 1024 ** 2;
const gibibyte = 1024 ** 3;

// Growth that no account explains: system areas should stay steady between releases
function growthWarning(category: HostUsageCategory, total: number): string {
	if (category.key === 'unreferenced' && category.bytes > Math.max(gibibyte, total * 0.2))
		return 'Large difference; inspect filesystem accounting';
	const day = category.growthDay ?? 0;
	const week = category.growthWeek ?? 0;
	const fast =
		day > Math.max(256 * mebibyte, category.bytes * 0.1) ||
		week > Math.max(gibibyte, category.bytes * 0.3);
	if (!fast) return '';
	return categories[category.key].userDriven
		? 'Growing fast; see which accounts below'
		: 'Unusual growth; check the service that writes here';
}

/**
 * Measured file sizes, filesystem metadata and the unattributed remainder as 100% of the
 * accounting total. Shared extents and compression can make this exceed stored pool usage.
 */
export function composition(usage: HostUsage): { segments: Segment[]; total: number } {
	const total = usage.categories.reduce((sum, category) => sum + category.bytes, 0);
	const segments: Segment[] = usage.categories
		.filter((category) => category.bytes > 0)
		.map((category) => ({
			key: category.key,
			label: categories[category.key].label,
			color: categories[category.key].color,
			bytes: category.bytes,
			share: total > 0 ? category.bytes / total : 0,
			growthDay: category.growthDay,
			growthWeek: category.growthWeek,
			warning: growthWarning(category, total)
		}));
	segments.sort((a, b) => b.bytes - a.bytes);
	return { segments, total };
}

/** Media on disk that no content references: uploads in progress or awaiting cleanup. */
export function unlinkedMedia(usage: HostUsage, data: AdminDataUsage): number {
	const onDisk = usage.categories.find((category) => category.key === 'media')?.bytes ?? 0;
	return Math.max(0, onDisk - data.referencedMedia);
}

export const appParts: { key: keyof AdminUserData['media']; label: string; color: string }[] = [
	{ key: 'posts', label: 'Posts', color: 'oklch(0.74 0.16 65)' },
	{ key: 'messages', label: 'Messages', color: 'oklch(0.65 0.15 145)' },
	{ key: 'channels', label: 'Channels', color: 'oklch(0.72 0.13 175)' },
	{ key: 'profile', label: 'Profile', color: 'oklch(0.64 0.17 300)' },
	{ key: 'journal', label: 'Journal', color: 'oklch(0.6 0.13 255)' },
	{ key: 'learning', label: 'Learning', color: 'oklch(0.68 0.16 345)' }
];

export interface UserRow {
	user: AdminUserData;
	parts: { key: string; label: string; color: string; bytes: number }[];
	shareOfUsers: number;
	flagged: boolean;
}

/**
 * Accounts by size with their application split. An account is flagged when it added at least
 * 512 MiB this week and more than everyone else together, which a normal week rarely shows.
 */
export function userRows(data: AdminDataUsage): UserRow[] {
	const all = data.users.reduce((sum, user) => sum + user.total, 0);
	const weekly = data.users.reduce((sum, user) => sum + user.addedWeek, 0);
	return data.users.map((user) => ({
		user,
		parts: appParts.map((part) => ({
			...part,
			bytes: user.media[part.key] + user.records[part.key]
		})),
		shareOfUsers: all > 0 ? user.total / all : 0,
		flagged: user.addedWeek >= 512 * mebibyte && user.addedWeek > weekly - user.addedWeek
	}));
}

/** Dead rows above a fifth of a large table mean cleanup lags behind updates. */
export function bloated(table: AdminDataUsage['tables'][number]): boolean {
	return table.deadRows > 10_000 && table.deadRows > table.rows * 0.2;
}

export function signedBytes(value: number | null, format: (bytes: number) => string): string {
	if (value === null) return '—';
	if (value === 0) return 'no change';
	return `${value > 0 ? '+' : '−'}${format(Math.abs(value))}`;
}
