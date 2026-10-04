// Describes service responsibilities and derives health from process outcomes and native timers
import type { AdminService } from "@kaordo/contracts";

const descriptions: Record<
	string,
	{ name: string; purpose: string; restart: string }
> = {
	kerno: {
		name: "Kerno",
		purpose:
			"Serves application APIs and checks access to accounts, posts, messages and communities.",
		restart:
			"Restart through a reviewed server deployment to keep API requests coordinated.",
	},
	nodo: {
		name: "Nodo",
		purpose: "Receives uploads, processes media and serves authorized files.",
		restart:
			"Restart pauses uploads and processing while the service reconnects.",
	},
	keycloak: {
		name: "Keycloak",
		purpose: "Handles registration, login, TOTP and shared identity sessions.",
		restart: "Restart through server maintenance; sign-in may be interrupted.",
	},
	postgresql: {
		name: "PostgreSQL",
		purpose: "Stores application metadata and Keycloak identity databases.",
		restart:
			"Restart through server maintenance so database clients shut down safely.",
	},
	caddy: {
		name: "Caddy",
		purpose:
			"Serves HTTPS, manages certificates and routes requests to applications and APIs.",
		restart:
			"Reload or restart through the host configuration to preserve public access.",
	},
	livekit: {
		name: "LiveKit",
		purpose:
			"Carries live audio, camera video and screen sharing in Rondo calls.",
		restart: "Restart disconnects active calls.",
	},
	ddclient: {
		name: "DNS updater",
		purpose:
			"Checks the public IP and updates the domain through a systemd timer. It exits between checks.",
		restart:
			"Update now starts one check and ensures that the automatic timer is enabled.",
	},
	prometheus: {
		name: "Prometheus",
		purpose:
			"Collects and stores performance measurements for dashboard history.",
		restart:
			"Restart through the host configuration; collection pauses during maintenance.",
	},
	"prometheus-node-exporter": {
		name: "Node Exporter",
		purpose:
			"Exposes CPU, memory, disk and network measurements to Prometheus.",
		restart:
			"Restart through the host configuration; measurements pause briefly.",
	},
	"regado-agent": {
		name: "Regado agent",
		purpose:
			"Reads host status and runs restricted, audited administration operations.",
		restart:
			"Restart through a deployment after active storage jobs have finished.",
	},
};

export function serviceDescription(id: string) {
	return (
		descriptions[id] ?? {
			name: id,
			purpose: "Host service",
			restart: "Managed through host configuration.",
		}
	);
}

export function servicePresentation(service: AdminService): {
	label: string;
	tone: "success" | "warning" | "danger" | "neutral";
} {
	if (service.loaded !== "loaded")
		return { label: "Unavailable", tone: "neutral" };
	if (
		service.active === "failed" ||
		(service.type === "oneshot" &&
			service.active === "inactive" &&
			service.result &&
			service.result !== "success")
	)
		return { label: "Failed", tone: "danger" };
	if (service.active === "activating")
		return { label: "Starting", tone: "warning" };
	if (service.active === "deactivating")
		return { label: "Stopping", tone: "warning" };
	if (service.active === "active")
		return {
			label: service.substate === "exited" ? "Completed" : "Running",
			tone: "success",
		};
	if (service.type === "oneshot" && service.timer?.active === "active")
		return { label: "Scheduled", tone: "success" };
	if (
		service.type === "oneshot" &&
		service.finishedAt &&
		service.result === "success"
	)
		return { label: "Completed", tone: "success" };
	if (service.active === "inactive")
		return { label: "Stopped", tone: "warning" };
	return { label: "Unknown", tone: "neutral" };
}
