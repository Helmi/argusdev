import {spawn, type StdioOptions} from 'child_process';
import {closeSync, openSync} from 'fs';
import {unlink} from 'fs/promises';
import {ENV_VARS} from '../constants/env.js';
import {
	getDaemonPidFilePath,
	isProcessRunning,
	readDaemonPidFile,
} from './daemonLifecycle.js';

const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 200;

export interface DaemonWebConfig {
	url: string;
	externalUrl?: string;
	hostname?: string;
	port: number;
	configDir: string;
	isCustomConfigDir: boolean;
	isDevMode: boolean;
}

export interface EnsureDaemonOptions {
	configDir: string;
	port: number;
	accessToken?: string;
	isCustomConfigDir: boolean;
	isDevMode: boolean;
	autoStart: boolean;
	timeoutMs?: number;
	pollIntervalMs?: number;
	entrypointPath?: string;
}

interface DaemonProcessHandle {
	pid?: number;
	unref(): void;
}

interface DaemonControlDependencies {
	readPidFile: (pidFilePath: string) => Promise<number | undefined>;
	isPidRunning: (pid: number) => boolean;
	removePidFile: (pidFilePath: string) => Promise<void>;
	spawnDaemon: (
		entrypointPath: string,
		port: number,
		options?: SpawnDetachedDaemonOptions,
	) => DaemonProcessHandle;
	fetchImpl: typeof globalThis.fetch;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
}

export interface EnsureDaemonResult {
	webConfig: DaemonWebConfig;
	pidFilePath: string;
	pid?: number;
	started: boolean;
}

function buildDaemonBaseUrl(port: number): string {
	return `http://127.0.0.1:${port}`;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}

function buildSpawnArgs(entrypointPath: string, port: number): string[] {
	return [...process.execArgv, entrypointPath, 'daemon', '--port', `${port}`];
}

export interface SpawnDetachedDaemonOptions {
	logFilePath?: string;
}

export function spawnDetachedDaemon(
	entrypointPath: string,
	port: number,
	options?: SpawnDetachedDaemonOptions,
): DaemonProcessHandle {
	let logFd: number | undefined;
	if (options?.logFilePath) {
		logFd = openSync(options.logFilePath, 'a');
	}

	const stdio: StdioOptions =
		logFd === undefined ? 'ignore' : ['ignore', logFd, logFd];

	// Strip dev-mode env vars so the background daemon always uses its own
	// config directory — never the local .argusdev-dev/ from a dev session.
	const cleanEnv = {...process.env};
	delete cleanEnv[ENV_VARS.DEV_MODE];
	delete cleanEnv[ENV_VARS.CONFIG_DIR];

	const child = spawn(process.execPath, buildSpawnArgs(entrypointPath, port), {
		detached: true,
		stdio,
		env: cleanEnv,
	});

	if (logFd !== undefined) {
		closeSync(logFd);
	}

	return child;
}

function createDaemonControlDependencies(
	overrides?: Partial<DaemonControlDependencies>,
): DaemonControlDependencies {
	return {
		readPidFile: readDaemonPidFile,
		isPidRunning: isProcessRunning,
		removePidFile: async pidFilePath => {
			try {
				await unlink(pidFilePath);
			} catch (error) {
				if (isErrnoException(error) && error.code === 'ENOENT') {
					return;
				}
				throw error;
			}
		},
		spawnDaemon: spawnDetachedDaemon,
		fetchImpl: globalThis.fetch.bind(globalThis),
		sleep: async (ms: number) =>
			new Promise(resolve => {
				setTimeout(resolve, ms);
			}),
		now: () => Date.now(),
		...overrides,
	};
}

export function buildDaemonWebConfig(params: {
	configDir: string;
	port: number;
	accessToken?: string;
	isCustomConfigDir: boolean;
	isDevMode: boolean;
}): DaemonWebConfig {
	const baseUrl = buildDaemonBaseUrl(params.port);
	const tokenPath = params.accessToken ? `/${params.accessToken}` : '';
	return {
		url: `${baseUrl}${tokenPath}`,
		port: params.port,
		configDir: params.configDir,
		isCustomConfigDir: params.isCustomConfigDir,
		isDevMode: params.isDevMode,
	};
}

export async function waitForDaemonPid(params: {
	pidFilePath: string;
	deadline: number;
	pollIntervalMs: number;
	deps?: Partial<DaemonControlDependencies>;
}): Promise<number> {
	const deps = createDaemonControlDependencies(params.deps);
	let lastSeenPid: number | undefined;

	while (deps.now() < params.deadline) {
		const pid = await deps.readPidFile(params.pidFilePath);
		if (pid !== undefined) {
			lastSeenPid = pid;
			if (deps.isPidRunning(pid)) {
				return pid;
			}
		}

		await deps.sleep(params.pollIntervalMs);
	}

	if (lastSeenPid !== undefined) {
		throw new Error(
			`Timed out waiting for daemon PID ${lastSeenPid} to become reachable.`,
		);
	}

	throw new Error(
		`Timed out waiting for daemon PID file at ${params.pidFilePath}.`,
	);
}

export async function waitForDaemonApiReady(params: {
	baseUrl: string;
	accessToken?: string;
	deadline: number;
	pollIntervalMs: number;
	deps?: Partial<DaemonControlDependencies>;
}): Promise<void> {
	const deps = createDaemonControlDependencies(params.deps);
	const headers = new globalThis.Headers();
	if (params.accessToken) {
		headers.set('x-access-token', params.accessToken);
	}

	const readinessUrl = `${params.baseUrl}/api/state`;
	let lastError: Error | undefined;

	while (deps.now() < params.deadline) {
		try {
			const remainingMs = params.deadline - deps.now();
			if (remainingMs <= 0) {
				break;
			}

			const response = await deps.fetchImpl(readinessUrl, {
				headers,
				signal: AbortSignal.timeout(Math.min(1000, remainingMs)),
			});

			if ([200, 401, 403].includes(response.status)) {
				return;
			}

			lastError = new Error(
				`Unexpected daemon status ${response.status} from ${readinessUrl}`,
			);
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}

		await deps.sleep(params.pollIntervalMs);
	}

	const suffix = lastError ? ` Last error: ${lastError.message}` : '';
	throw new Error(
		`Timed out waiting for daemon API at ${readinessUrl}.${suffix}`,
	);
}

export async function ensureDaemon(
	options: EnsureDaemonOptions,
	dependencies?: Partial<DaemonControlDependencies>,
): Promise<EnsureDaemonResult> {
	const deps = createDaemonControlDependencies(dependencies);
	const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
	const deadline = deps.now() + timeoutMs;
	const pidFilePath = getDaemonPidFilePath(options.configDir);
	const webConfig = buildDaemonWebConfig({
		configDir: options.configDir,
		port: options.port,
		accessToken: options.accessToken,
		isCustomConfigDir: options.isCustomConfigDir,
		isDevMode: options.isDevMode,
	});

	const existingPid = await deps.readPidFile(pidFilePath);
	if (existingPid !== undefined && deps.isPidRunning(existingPid)) {
		await waitForDaemonApiReady({
			baseUrl: buildDaemonBaseUrl(options.port),
			accessToken: options.accessToken,
			deadline,
			pollIntervalMs,
			deps,
		});
		return {
			webConfig,
			pidFilePath,
			pid: existingPid,
			started: false,
		};
	}

	if (existingPid !== undefined) {
		await deps.removePidFile(pidFilePath);
	}

	if (!options.autoStart) {
		throw new Error(
			'No running ArgusDev daemon found. Start it with `argusdev daemon`, or run `argusdev` to auto-start it.',
		);
	}

	const entrypointPath = options.entrypointPath ?? process.argv[1];
	if (!entrypointPath) {
		throw new Error(
			'Unable to auto-start daemon: missing CLI entrypoint path.',
		);
	}

	const daemonProcess = deps.spawnDaemon(entrypointPath, options.port);
	daemonProcess.unref();

	const daemonPid = await waitForDaemonPid({
		pidFilePath,
		deadline,
		pollIntervalMs,
		deps,
	});

	await waitForDaemonApiReady({
		baseUrl: buildDaemonBaseUrl(options.port),
		accessToken: options.accessToken,
		deadline,
		pollIntervalMs,
		deps,
	});

	return {
		webConfig,
		pidFilePath,
		pid: daemonPid,
		started: true,
	};
}
