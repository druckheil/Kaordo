// Adds authenticated retry and consistent errors to Kerno requests

import { authorizedFetch, refreshAccessToken } from '@kaordo/auth';

export async function sessionFetch(
	input: RequestInfo | URL,
	init?: RequestInit
): Promise<Response> {
	const request = new Request(input, init);
	const response = await authorizedFetch(request.clone());
	if (response.status !== 401) return response;

	request.signal.throwIfAborted();
	await refreshAccessToken();
	request.signal.throwIfAborted();
	return authorizedFetch(request.clone());
}

function apiError(error: unknown, status: number): Error {
	return new Error(apiErrorDetail(error) ?? `Request failed (${status}).`);
}

export function apiErrorDetail(error: unknown): string | undefined {
	if (!isErrorPayload(error)) return undefined;
	return typeof error.error === 'string' ? error.error : undefined;
}

export function requireResponseData<T>(
	data: T | null | undefined,
	error: unknown,
	status: number
): T {
	if (data === undefined || data === null) throw apiError(error, status);
	return data;
}

export function requireResponseOk(response: Response, error: unknown): void {
	if (!response.ok) throw apiError(error, response.status);
}

function isErrorPayload(value: unknown): value is { error?: unknown } {
	return typeof value === 'object' && value !== null && 'error' in value;
}
