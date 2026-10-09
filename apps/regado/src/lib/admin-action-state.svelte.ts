// Owns administrative command confirmation and mutation feedback
import type { QueryClient } from '@tanstack/svelte-query';
import type { AdminApi } from '@kaordo/api-client';
import {
	errorMessage,
	restartActions,
	type AdminIntent,
	type RestartableService
} from './regado-model';

interface ActionDependencies {
	api: Pick<AdminApi, 'action' | 'setLogRetention' | 'setStatus' | 'setRole'>;
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
	const form = $state({ intent: null as AdminIntent | null, reason: '' });
	const status = $state({ busy: false, operationError: '', actionError: '', notice: '' });
	const lifetime = new AbortController();

	function openIntent(next: AdminIntent): void {
		form.intent = next;
		form.reason = '';
		status.actionError = '';
		status.notice = '';
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

	function requestMediaAction(id: 'check-media' | 'clean-media'): void {
		openIntent({
			type: 'action',
			id,
			name: id === 'check-media' ? 'Check media files' : 'Clean up media files'
		});
	}

	async function confirmIntent(): Promise<void> {
		const selectedIntent = form.intent;
		if (!selectedIntent || status.busy) return;

		status.busy = true;
		status.actionError = '';
		status.operationError = '';
		status.notice = '';
		try {
			lifetime.signal.throwIfAborted();
			await performIntent(selectedIntent);
			lifetime.signal.throwIfAborted();
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['regado', 'summary'] }),
				queryClient.invalidateQueries({ queryKey: ['regado', 'audit'] })
			]);
			if (!lifetime.signal.aborted) form.intent = null;
		} catch (cause) {
			if (!lifetime.signal.aborted) status.actionError = errorMessage(cause);
		} finally {
			if (!lifetime.signal.aborted) status.busy = false;
		}
	}

	async function performIntent(selected: AdminIntent): Promise<void> {
		switch (selected.type) {
			case 'log-retention': {
				const result = await api.setLogRetention(selected.days, form.reason, lifetime.signal);
				lifetime.signal.throwIfAborted();
				status.notice = result.warning || 'Journal retention updated.';
				await queryClient.invalidateQueries({ queryKey: ['regado', 'logs'] });
				return;
			}
			case 'status':
				await api.setStatus(selected.id, selected.disabled, form.reason, lifetime.signal);
				lifetime.signal.throwIfAborted();
				status.notice = `${selected.name} ${selected.disabled ? 'disabled' : 'enabled'}.`;
				await loadUsers();
				return;
			case 'role':
				await api.setRole(selected.id, selected.isAdmin, form.reason, lifetime.signal);
				lifetime.signal.throwIfAborted();
				status.notice = `Administrator role ${selected.isAdmin ? 'granted to' : 'revoked from'} @${selected.name}.`;
				await loadUsers();
				return;
			case 'action': {
				const result = await api.action(selected.id, form.reason, lifetime.signal);
				lifetime.signal.throwIfAborted();
				status.notice = result.output || `${selected.name} requested.`;
				await refreshOverview();
			}
		}
	}
	return {
		form,
		get status(): Readonly<typeof status> {
			return status;
		},
		openIntent,
		requestDnsRestart,
		requestServiceRestart,
		requestMediaAction,
		confirmIntent,
		clearOperationError() {
			status.operationError = '';
		},
		dispose() {
			lifetime.abort();
		}
	};
}
