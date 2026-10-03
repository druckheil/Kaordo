import type {
	AdminAccessCase,
	AdminAuditEntry,
	AdminContentPage,
	AdminLogs,
	AdminMetrics,
	AdminSummary,
	AdminSystem,
	AdminUser,
} from "@kaordo/contracts";
import { apiError, sessionFetch } from "./http.ts";

export function createAdminApi(apiBaseUrl: string) {
	const base = apiBaseUrl.replace(/\/$/, "") + "/v1/admin";
	async function request<T>(path: string, init?: RequestInit): Promise<T> {
		const response = await sessionFetch(base + path, {
			...init,
			headers: {
				Accept: "application/json",
				...(init?.body ? { "Content-Type": "application/json" } : {}),
				...init?.headers,
			},
		});
		if (response.status === 204) return undefined as T;
		const data: unknown = await response.json();
		if (!response.ok) throw apiError(data, response.status);
		return data as T;
	}

	return {
		summary: () => request<AdminSummary>("/summary"),
		system: () => request<AdminSystem>("/system"),
		metrics: (window: "1h" | "24h" | "7d") =>
			request<AdminMetrics>(`/metrics?window=${window}`),
		users: (q = "") =>
			request<{ items: AdminUser[] }>(`/users?q=${encodeURIComponent(q)}`),
		setStatus: (id: string, disabled: boolean, reason: string) =>
			request<AdminUser>(`/users/${encodeURIComponent(id)}/status`, {
				method: "PATCH",
				body: JSON.stringify({ disabled, reason }),
			}),
		setRole: (id: string, isAdmin: boolean, reason: string) =>
			request<AdminUser>(`/users/${encodeURIComponent(id)}/role`, {
				method: "PATCH",
				body: JSON.stringify({ isAdmin, reason }),
			}),
		audit: () => request<{ items: AdminAuditEntry[] }>("/audit"),
		createCase: (targetUserId: string, reason: string) =>
			request<AdminAccessCase>("/cases", {
				method: "POST",
				body: JSON.stringify({ targetUserId, reason }),
			}),
		closeCase: (id: string) =>
			request<void>(`/cases/${encodeURIComponent(id)}/close`, {
				method: "POST",
			}),
		caseContent: (id: string, kind: "posts" | "messages", before?: string) =>
			request<AdminContentPage>(
				`/cases/${encodeURIComponent(id)}/content?kind=${kind}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
			),
		logs: (service: string) =>
			request<AdminLogs>(`/logs?service=${encodeURIComponent(service)}`),
		action: (
			action:
				"restart-nodo" | "restart-livekit" | "restart-ddclient" | "scrub-data",
			reason: string,
		) =>
			request<{ action: string; accepted: boolean; output: string }>(
				`/actions/${action}`,
				{ method: "POST", body: JSON.stringify({ reason }) },
			),
	};
}

export type AdminApi = ReturnType<typeof createAdminApi>;
