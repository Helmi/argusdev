import {afterEach, describe, expect, it, vi} from 'vitest';
import {join} from 'path';
import {buildDaemonWebConfig, ensureDaemon} from './daemonControl.js';

describe('daemonControl', () => {
	const originalArgv = [...process.argv];

	afterEach(() => {
		process.argv = [...originalArgv];
	});

	it('builds daemon web config with access token path', () => {
		const config = buildDaemonWebConfig({
			configDir: '/tmp/argusdev',
			port: 3100,
			accessToken: 'abc123',
			isCustomConfigDir: true,
			isDevMode: false,
		});

		expect(config).toEqual({
			url: 'http://127.0.0.1:3100/abc123',
			port: 3100,
			configDir: '/tmp/argusdev',
			isCustomConfigDir: true,
			isDevMode: false,
		});
	});

	it('reuses an already-running daemon without spawning a new process', async () => {
		const spawnDaemon = vi.fn();
		const removePidFile = vi.fn();
		const fetchImpl = vi.fn(
			async () => new globalThis.Response('{}', {status: 200}),
		);

		const result = await ensureDaemon(
			{
				configDir: '/tmp/argusdev',
				port: 3000,
				accessToken: 'token',
				isCustomConfigDir: false,
				isDevMode: false,
				autoStart: true,
			},
			{
				readPidFile: async () => 4242,
				isPidRunning: () => true,
				removePidFile,
				spawnDaemon,
				fetchImpl,
				sleep: async () => {},
				now: () => 0,
			},
		);

		expect(result.started).toBe(false);
		expect(result.pid).toBe(4242);
		expect(result.webConfig.url).toBe('http://127.0.0.1:3000/token');
		expect(spawnDaemon).not.toHaveBeenCalled();
		expect(removePidFile).not.toHaveBeenCalled();
		expect(fetchImpl).toHaveBeenCalledWith(
			'http://127.0.0.1:3000/api/state',
			expect.objectContaining({
				headers: expect.any(globalThis.Headers),
			}),
		);
	});

	it('removes stale PID and fails when daemon is missing and autoStart is false', async () => {
		const removePidFile = vi.fn(async () => {});

		await expect(
			ensureDaemon(
				{
					configDir: '/tmp/argusdev',
					port: 3000,
					isCustomConfigDir: false,
					isDevMode: false,
					autoStart: false,
				},
				{
					readPidFile: async () => 9999,
					isPidRunning: () => false,
					removePidFile,
					spawnDaemon: vi.fn(),
					fetchImpl: vi.fn(),
					sleep: async () => {},
					now: () => 0,
				},
			),
		).rejects.toThrow('No running ArgusDev daemon found');

		expect(removePidFile).toHaveBeenCalledTimes(1);
	});

	it('auto-starts daemon and waits for PID + API readiness', async () => {
		let nowMs = 0;
		const unref = vi.fn();
		const spawnDaemon = vi.fn(() => ({pid: 7777, unref}));
		const readPidFile = vi
			.fn<(_: string) => Promise<number | undefined>>()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(7777);
		const fetchImpl = vi.fn(
			async () => new globalThis.Response('{}', {status: 200}),
		);

		const result = await ensureDaemon(
			{
				configDir: '/tmp/argusdev',
				port: 3999,
				accessToken: 'token',
				isCustomConfigDir: true,
				isDevMode: true,
				autoStart: true,
				timeoutMs: 3000,
				pollIntervalMs: 50,
				entrypointPath: '/tmp/cli.tsx',
			},
			{
				readPidFile,
				isPidRunning: pid => pid === 7777,
				removePidFile: async () => {},
				spawnDaemon,
				fetchImpl,
				sleep: async ms => {
					nowMs += ms;
				},
				now: () => nowMs,
			},
		);

		expect(result.started).toBe(true);
		expect(result.pid).toBe(7777);
		expect(result.webConfig.url).toBe('http://127.0.0.1:3999/token');
		expect(spawnDaemon).toHaveBeenCalledWith('/tmp/cli.tsx', 3999);
		expect(unref).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledWith(
			'http://127.0.0.1:3999/api/state',
			expect.objectContaining({
				headers: expect.any(globalThis.Headers),
			}),
		);
	});

	it('removes stale PID and restarts daemon when auto-start is enabled', async () => {
		let nowMs = 0;
		const removePidFile = vi.fn(async () => {});
		const unref = vi.fn();
		const spawnDaemon = vi.fn(() => ({pid: 8888, unref}));
		const readPidFile = vi
			.fn<(_: string) => Promise<number | undefined>>()
			.mockResolvedValueOnce(7000)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(8888);
		const fetchImpl = vi.fn(
			async () => new globalThis.Response('{}', {status: 200}),
		);

		const result = await ensureDaemon(
			{
				configDir: '/tmp/argusdev',
				port: 3000,
				accessToken: 'token',
				isCustomConfigDir: false,
				isDevMode: false,
				autoStart: true,
				timeoutMs: 3000,
				pollIntervalMs: 50,
				entrypointPath: '/tmp/unified-entry.tsx',
			},
			{
				readPidFile,
				isPidRunning: pid => pid === 8888,
				removePidFile,
				spawnDaemon,
				fetchImpl,
				sleep: async ms => {
					nowMs += ms;
				},
				now: () => nowMs,
			},
		);

		expect(result.started).toBe(true);
		expect(result.pid).toBe(8888);
		expect(removePidFile).toHaveBeenCalledWith(join('/tmp/argusdev', 'daemon.pid'));
		expect(removePidFile.mock.invocationCallOrder[0]).toBeLessThan(
			spawnDaemon.mock.invocationCallOrder[0]!,
		);
		expect(spawnDaemon).toHaveBeenCalledWith('/tmp/unified-entry.tsx', 3000);
		expect(unref).toHaveBeenCalledTimes(1);
	});

	it('uses unified entrypoint from process.argv when auto-starting daemon', async () => {
		process.argv = ['node', '/tmp/unified-entry.tsx'];

		let nowMs = 0;
		const unref = vi.fn();
		const spawnDaemon = vi.fn(() => ({pid: 7777, unref}));
		const readPidFile = vi
			.fn<(_: string) => Promise<number | undefined>>()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(7777);
		const fetchImpl = vi.fn(
			async () => new globalThis.Response('{}', {status: 200}),
		);

		const result = await ensureDaemon(
			{
				configDir: '/tmp/argusdev',
				port: 4001,
				accessToken: 'token',
				isCustomConfigDir: false,
				isDevMode: false,
				autoStart: true,
				timeoutMs: 1000,
				pollIntervalMs: 50,
			},
			{
				readPidFile,
				isPidRunning: pid => pid === 7777,
				removePidFile: async () => {},
				spawnDaemon,
				fetchImpl,
				sleep: async ms => {
					nowMs += ms;
				},
				now: () => nowMs,
			},
		);

		expect(result.started).toBe(true);
		expect(result.pid).toBe(7777);
		expect(spawnDaemon).toHaveBeenCalledWith('/tmp/unified-entry.tsx', 4001);
		expect(unref).toHaveBeenCalledTimes(1);
	});
});
