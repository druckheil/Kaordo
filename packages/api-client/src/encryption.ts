// Provides owner-scoped public identities and signed device approvals
import type { EncryptionApproval, EncryptionRegistration, paths } from '@kaordo/contracts';
import createClient from 'openapi-fetch';
import { requireResponseData, requireResponseOk, sessionFetch } from './http.ts';

export type AudienceModule = 'ligo' | 'ligo-history' | 'rondo';

export function createEncryptionApi(baseUrl: string) {
	const client = createClient<paths>({ baseUrl, fetch: sessionFetch });
	return {
		async recovery(signal?: AbortSignal) {
			const { data, error, response } = await client.GET('/v1/crypto/recovery', { signal });
			return requireResponseData(data, error, response.status).wrappedKeys;
		},
		async saveRecovery(
			body: { expectedWrappedKeys: string; wrappedKeys: string; signature: string },
			signal?: AbortSignal
		) {
			const { data, error, response } = await client.PUT('/v1/crypto/recovery', { body, signal });
			return requireResponseData(data, error, response.status);
		},
		async publicIdentity(id: string, signal?: AbortSignal) {
			const { data, error, response } = await client.GET('/v1/crypto/users/{id}', {
				params: { path: { id } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async audience(
			module: AudienceModule,
			id: string,
			privateContent = false,
			signal?: AbortSignal
		) {
			const { data, error, response } = await client.GET('/v1/crypto/audience/{module}/{id}', {
				params: { path: { module, id }, query: { private: privateContent } },
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		async identity(signal?: AbortSignal) {
			const { data, error, response } = await client.GET('/v1/crypto/identity', { signal });
			return requireResponseData(data, error, response.status).identity;
		},
		async register(body: EncryptionRegistration, signal?: AbortSignal) {
			const { data, error, response } = await client.POST('/v1/crypto/devices', { body, signal });
			return requireResponseData(data, error, response.status);
		},
		async approve(id: string, body: EncryptionApproval, signal?: AbortSignal) {
			const { data, error, response } = await client.POST('/v1/crypto/devices/{id}/approve', {
				params: { path: { id } },
				body,
				signal
			});
			return requireResponseData(data, error, response.status);
		},
		/** Records that the current sign-in session uses this device. */
		async useDevice(id: string, signal?: AbortSignal) {
			const { error, response } = await client.PUT('/v1/crypto/devices/{id}/session', {
				params: { path: { id } },
				signal
			});
			requireResponseOk(response, error);
		},
		async forgetDevice(id: string, signature: string, signal?: AbortSignal) {
			const { data, error, response } = await client.DELETE('/v1/crypto/devices/{id}', {
				params: { path: { id } },
				body: { signature },
				signal
			});
			return requireResponseData(data, error, response.status);
		}
	};
}
export type EncryptionApi = ReturnType<typeof createEncryptionApi>;
