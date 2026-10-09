// Owns administrative command confirmation and mutation feedback
import type { QueryClient } from '@tanstack/svelte-query';
import type { AdminApi } from '@kaordo/api-client';
import type { AdminLayoutRequest } from '@kaordo/contracts';
import {
	errorMessage,
	restartActions,
	type AdminIntent,
	type RestartableService
} from './regado-model';

interface ActionDependencies {
	api: Pick<
		AdminApi,
		'action' | 'applyStorageLayout' | 'setLogRetention' | 'setStatus' | 'setRole'
	>;
	queryClient: QueryClient;
	refreshOverview: () => Promise<void>;
	loadUsers: () => Promise<void>;
}

export function createAdminActionState({
	api,
	queryClient,
	refreshOverview,
	loadUsers
}: ActionDependencies) {
	const form = $state({ intent: null as AdminIntent | null, reason: '', confirmation: '' });
	const status = $state({ busy: false, operationError: '', actionError: '', notice: '' });
	let disposed = false;
	const lifetime = new AbortController();

	function openIntent(next: AdminIntent): void {
		form.intent = next;
		form.reason = '';
		form.confirmation = '';
		status.actionError = '';
		status.notice = '';
	}

	async function requestCopyCheck(path: string): Promise<void> {
		if (disposed || status.busy) return;
		status.busy = true;
		status.operationError = '';
		try {
			const result = await api.action(
				'check-storage',
				'Verify file copies, checksums and expired upload references',
				{ target: path },
				lifetime.signal
			);
			if (disposed) return;
			status.notice = result.output;
			await refreshOverview();
		} catch (cause) {
			if (!disposed) status.operationError = errorMessage(cause);
		} finally {
			if (!disposed) status.busy = false;
		}
	}

	async function applyStorageLayout(
		body: AdminLayoutRequest & { fingerprint: string; confirmation: string; reason: string }
	): Promise<void> {
		const result = await api.applyStorageLayout(body, lifetime.signal);
		if (disposed) return;
		status.notice = result.output;
		await refreshOverview();
	}

	function requestCopyRepair(path: string): void {
		openIntent({
			type: 'action',
			id: 'repair-storage',
			name: `Repair file copies in ${path}`,
			target: path
		});
		form.reason = 'Restore two-copy storage and remove expired unreferenced uploads';
	}

	function requestDnsRestart(): void {
		openIntent({
			type: 'action',
			id: 'restart-ddclient',
			name: 'Update DNS now'
		});
	}

	function requestServiceRestart(serviceId: RestartableService): void {
		openIntent({
			type: 'action',
			id: restartActions[serviceId],
			name: serviceId === 'ddclient' ? 'Update DNS now' : `Restart ${serviceId}`
		});
	}

	async function confirmIntent(): Promise<void> {
		const selectedIntent = form.intent;
		if (disposed || !selectedIntent || status.busy) return;

		status.busy = true;
		status.actionError = '';
		status.operationError = '';
		status.notice = '';
		try {
			await performIntent(selectedIntent);
			if (disposed) return;
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['regado', 'summary'] }),
				queryClient.invalidateQueries({ queryKey: ['regado', 'audit'] })
			]);
			if (!disposed) form.intent = null;
		} catch (cause) {
			if (!disposed) status.actionError = errorMessage(cause);
		} finally {
			if (!disposed) status.busy = false;
		}
	}

	async function performIntent(selected: AdminIntent): Promise<void> {
		switch (selected.type) {
			case 'log-retention': {
				const result = await api.setLogRetention(selected.days, form.reason, lifetime.signal);
				if (disposed) return;
				status.notice = result.warning || 'Journal retention updated.';
				await queryClient.invalidateQueries({ queryKey: ['regado', 'logs'] });
				return;
			}
			case 'status':
				await api.setStatus(selected.id, selected.disabled, form.reason, lifetime.signal);
				if (disposed) return;
				status.notice = `${selected.name} ${selected.disabled ? 'disabled' : 'enabled'}.`;
				await loadUsers();
				return;
			case 'role':
				await api.setRole(selected.id, selected.isAdmin, form.reason, lifetime.signal);
				if (disposed) return;
				status.notice = `Administrator role ${selected.isAdmin ? 'granted to' : 'revoked from'} @${selected.name}.`;
				await loadUsers();
				return;
			case 'action':
				const result = await api.action(
					selected.id,
					form.reason,
					{
						target: selected.target,
						identity: selected.identity,
						filesystem: selected.filesystem
					},
					lifetime.signal
				);
				if (disposed) return;
				status.notice = result.output || `${selected.name} requested.`;
				await refreshOverview();
		}
	}
	return {
		form,
		get status(): Readonly<typeof status> {
			return status;
		},
		openIntent,
		requestCopyCheck,
		applyStorageLayout,
		requestCopyRepair,
		requestDnsRestart,
		requestServiceRestart,
		confirmIntent,
		clearOperationError() {
			status.operationError = '';
		},
		dispose() {
			disposed = true;
			lifetime.abort();
		}
	};
}
