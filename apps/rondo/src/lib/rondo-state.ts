// Normalizes Rondo route, layout, and conversation cache state

export interface RondoLayoutPreferences {
	servers?: boolean;
	channels?: boolean;
	members?: boolean;
}

export interface RondoRoute {
	serverId: string;
	channelId: string | null;
}

export function getInitials(name: string): string {
	return (
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0])
			.join('')
			.toUpperCase() || 'R'
	);
}

export function parseRondoRoute(hash: string): RondoRoute | null {
	const match = /^#s\/([0-9a-f-]{36})(?:\/c\/([0-9a-f-]{36}))?$/i.exec(hash);
	if (!match) return null;
	return { serverId: match[1], channelId: match.at(2) ?? null };
}

export function formatRondoRoute(serverId: string, channelId: string | null): string {
	return `s/${serverId}${channelId ? `/c/${channelId}` : ''}`;
}

export function parseLayoutPreferences(raw: string | null): RondoLayoutPreferences {
	try {
		const value: unknown = JSON.parse(raw ?? '{}');
		if (!isRecord(value)) return {};

		return {
			...(typeof value.servers === 'boolean' ? { servers: value.servers } : {}),
			...(typeof value.channels === 'boolean' ? { channels: value.channels } : {}),
			...(typeof value.members === 'boolean' ? { members: value.members } : {})
		};
	} catch {
		return {};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
