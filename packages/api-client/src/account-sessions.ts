// Lists and ends the account's sign-in sessions through the identity provider's account API

import { accountApiUrl } from '@kaordo/auth';
import { sessionFetch } from './http.ts';

/** One browser's sign-in, as Keycloak reports it; times are milliseconds since the epoch. */
export interface AccountSession {
	id: string;
	current: boolean;
	ipAddress: string;
	browser: string;
	os: string;
	device: string;
	mobile: boolean;
	started: number;
	lastAccess: number;
	expires: number;
}

interface KeycloakSession {
	id: string;
	ipAddress: string;
	started: number;
	lastAccess: number;
	expires: number;
	browser: string;
	current?: boolean;
}

interface KeycloakDevice {
	os: string;
	osVersion: string;
	device: string;
	mobile: boolean;
	sessions: KeycloakSession[];
}

export function createAccountSessionsApi() {
	async function request(path: string, init: RequestInit) {
		const response = await sessionFetch(accountApiUrl() + path, {
			...init,
			headers: { Accept: 'application/json' }
		});
		if (!response.ok) throw new Error(`The sessions request failed (${response.status}).`);
		return response;
	}
	return {
		async list(signal?: AbortSignal): Promise<AccountSession[]> {
			const response = await request('/sessions/devices', { signal });
			const devices = (await response.json()) as KeycloakDevice[];
			return devices
				.flatMap((device) =>
					device.sessions.map((session) => ({
						id: session.id,
						current: session.current === true,
						ipAddress: session.ipAddress,
						browser: session.browser,
						os: [device.os, device.osVersion]
							.filter((part) => part && part !== 'Unknown')
							.join(' '),
						device: device.device,
						mobile: device.mobile,
						// Keycloak reports seconds
						started: session.started * 1000,
						lastAccess: session.lastAccess * 1000,
						expires: session.expires * 1000
					}))
				)
				.sort((a, b) => Number(b.current) - Number(a.current) || b.lastAccess - a.lastAccess);
		},
		async signOut(id: string, signal?: AbortSignal) {
			await request(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
		},
		/** Ends every session except the one making the request. */
		async signOutOthers(signal?: AbortSignal) {
			await request('/sessions', { method: 'DELETE', signal });
		}
	};
}
export type AccountSessionsApi = ReturnType<typeof createAccountSessionsApi>;

export const accountSessionsKey = ['account', 'sessions'] as const;

export function accountSessionsOptions(api: AccountSessionsApi) {
	return {
		queryKey: accountSessionsKey,
		queryFn: ({ signal }: { signal: AbortSignal }) => api.list(signal),
		staleTime: 15_000,
		refetchInterval: 30_000
	};
}
