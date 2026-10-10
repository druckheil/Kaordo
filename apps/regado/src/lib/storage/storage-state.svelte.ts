// Owns the Storage view's host queries, plan previews, desired-state changes and cancellations

import { onDestroy } from 'svelte';
import { createMutation, createQuery, type QueryClient } from '@tanstack/svelte-query';
import {
	adminHostAlertsOptions,
	adminHostOperationsOptions,
	adminHostOptions,
	type AdminApi
} from '@kaordo/api-client';
import type { HostCheckRequest, HostPoolPlan, HostState, HostStateChange } from '@kaordo/contracts';
import { activeOperation } from './storage-model';

export function createStorageState(api: AdminApi, queryClient: QueryClient, host: string) {
	const operations = createQuery(
		() => adminHostOperationsOptions(api, host),
		() => queryClient
	);
	const running = $derived(activeOperation(operations.data?.items ?? []));
	const facts = createQuery(
		() => adminHostOptions(api, host, running !== undefined),
		() => queryClient
	);

	// When an operation finishes, the host has changed; read it again at once
	let previousRunning: string | undefined;
	$effect(() => {
		const current = running?.id;
		if (previousRunning && !current)
			void queryClient.invalidateQueries({ queryKey: ['regado', 'hosts', host] });
		previousRunning = current;
	});

	const refresh = () => queryClient.invalidateQueries({ queryKey: ['regado', 'hosts', host] });
	const apply = createMutation(
		() => ({
			mutationFn: (change: HostStateChange) => api.applyHostState(host, change),
			onSuccess: refresh
		}),
		() => queryClient
	);
	const alerts = createQuery(
		() => adminHostAlertsOptions(api, host),
		() => queryClient
	);
	const testAlerts = createMutation(
		() => ({ mutationFn: () => api.testHostAlerts(host) }),
		() => queryClient
	);
	const startCheck = createMutation(
		() => ({
			mutationFn: (check: HostCheckRequest) => api.startHostCheck(host, check),
			onSuccess: refresh
		}),
		() => queryClient
	);
	const cancel = createMutation(
		() => ({
			mutationFn: (operation: string) => api.cancelHostOperation(host, operation),
			onSuccess: refresh
		}),
		() => queryClient
	);

	// Plan previews supersede each other; only the latest may update the dialog
	let planRequest: AbortController | undefined;
	async function plan(document: HostState): Promise<HostPoolPlan | undefined> {
		planRequest?.abort();
		const request = new AbortController();
		planRequest = request;
		try {
			return await api.planHostState(host, document, request.signal);
		} catch (error) {
			if (request.signal.aborted) return undefined;
			throw error;
		}
	}
	onDestroy(() => planRequest?.abort());

	return {
		host,
		get facts() {
			return facts;
		},
		get operations() {
			return operations;
		},
		get running() {
			return running;
		},
		get alerts() {
			return alerts;
		},
		testAlerts,
		apply,
		startCheck,
		cancel,
		plan,
		refresh
	};
}

export type StorageState = ReturnType<typeof createStorageState>;
