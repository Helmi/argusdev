/* global fetch, Response, Headers, HeadersInit */
import {describe, it, expect, vi} from 'vitest';
import {
	ApiClient,
	ApiClientError,
	createApiClient,
	resolveDaemonApiConfig,
} from './apiClient.js';

describe('apiClient', () => {
	it('resolves daemon API config from configuration defaults', () => {
		const resolved = resolveDaemonApiConfig({
			config: {
				port: 4242,
				accessToken: 'token-123',
			},
			env: {},
		});

		expect(resolved.baseUrl).toBe('http://localhost:4242');
		expect(resolved.port).toBe(4242);
		expect(resolved.accessToken).toBe('token-123');
	});

	it('prefers ARGUSDEV_PORT over config port when resolving API config', () => {
		const resolved = resolveDaemonApiConfig({
			config: {
				port: 3000,
			},
			env: {
				ARGUSDEV_PORT: '5151',
			} as NodeJS.ProcessEnv,
		});

		expect(resolved.baseUrl).toBe('http://localhost:5151');
		expect(resolved.port).toBe(5151);
	});

	it('supports GET/POST/DELETE JSON requests with auth header', async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ok: true, method: 'get'}), {status: 200}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ok: true, method: 'post'}), {status: 200}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ok: true, method: 'delete'}), {
					status: 200,
				}),
			);

		const client = new ApiClient({
			baseUrl: 'http://localhost:3000',
			accessToken: 'secret-token',
			fetchImpl,
		});

		await expect(
			client.get<{ok: boolean; method: string}>('/api/state'),
		).resolves.toEqual({
			ok: true,
			method: 'get',
		});
		await expect(
			client.post<{ok: boolean; method: string}>('/api/project/add', {
				path: '/tmp/repo',
			}),
		).resolves.toEqual({
			ok: true,
			method: 'post',
		});
		await expect(
			client.delete<{ok: boolean; method: string}>('/api/project/remove'),
		).resolves.toEqual({
			ok: true,
			method: 'delete',
		});

		expect(fetchImpl).toHaveBeenCalledTimes(3);
		for (const call of fetchImpl.mock.calls) {
			const init = call[1];
			const headers = new Headers(init?.headers as HeadersInit);
			expect(headers.get('x-access-token')).toBe('secret-token');
			expect(headers.get('accept')).toBe('application/json');
		}
	});

	it('returns a clear error when daemon is not running', async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new TypeError('fetch failed'));
		const client = createApiClient({
			config: {
				port: 3333,
				accessToken: 'token',
			},
			fetchImpl,
		});

		await expect(client.get('/api/state')).rejects.toThrow(
			'Unable to connect to ArgusDev daemon at http://localhost:3333. Is the daemon running? Try `argusdev start`.',
		);
	});

	it('throws ApiClientError on non-2xx responses', async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(JSON.stringify({message: 'forbidden'}), {status: 403}),
			);
		const client = new ApiClient({
			baseUrl: 'http://localhost:3000',
			fetchImpl,
		});

		const request = client.get('/api/state');
		await expect(request).rejects.toBeInstanceOf(ApiClientError);
		await expect(request).rejects.toMatchObject({
			status: 403,
		});
	});
});
