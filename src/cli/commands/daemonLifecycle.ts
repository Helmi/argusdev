import {mkdir} from 'fs/promises';
import {createApiClient, ApiClientError} from '../apiClient.js';
import type {DaemonWebConfig} from '../../utils/daemonControl.js';
import type {CliCommandContext} from '../types.js';
import {checkForUpdate} from '../../services/versionCheckService.js';
import {
	formatDaemonVersionHeader,
	getProcessUptime,
	openBrowser,
	withNetworkLinks,
} from './daemonUtils.js';

const DAEMON_READY_TIMEOUT_MS = 15_000;
const DAEMON_POLL_INTERVAL_MS = 200;
const DAEMON_STOP_TIMEOUT_MS = 5_000;

interface DaemonSessionPayload {
	id?: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

function normalizeApiError(error: unknown): Error {
	if (error instanceof ApiClientError) {
		return new Error(error.message);
	}

	if (error instanceof Error) {
		return error;
	}

	return new Error(String(error));
}

async function listActiveSessionIds(
	context: CliCommandContext,
): Promise<string[]> {
	const client = createApiClient({
		host: '127.0.0.1',
		port: context.port,
		accessToken: context.accessToken,
	});
	const sessions = await client.get<DaemonSessionPayload[]>('/api/sessions');
	return sessions
		.map(session => session.id?.trim())
		.filter((sessionId): sessionId is string => !!sessionId);
}

async function terminateActiveSessionsForLifecycle(
	context: CliCommandContext,
): Promise<{terminated: number; activeSessionIds: string[]}> {
	const activeSessionIds = await listActiveSessionIds(context);
	const client = createApiClient({
		host: '127.0.0.1',
		port: context.port,
		accessToken: context.accessToken,
	});
	let terminated = 0;
	for (const sessionId of activeSessionIds) {
		const response = await client.post<{success?: boolean}>(
			'/api/session/stop',
			{
				id: sessionId,
			},
		);
		if (response.success !== false) {
			terminated += 1;
		}
	}

	return {terminated, activeSessionIds};
}

function formatActiveSessionList(sessionIds: string[]): string {
	if (sessionIds.length === 0) {
		return 'none';
	}
	return `${sessionIds.slice(0, 5).join(', ')}${sessionIds.length > 5 ? ', ...' : ''}`;
}

async function startDaemonInBackground(context: CliCommandContext): Promise<{
	pid: number;
	started: boolean;
	webConfig: DaemonWebConfig;
}> {
	const existingPid = await context.daemon.lifecycle.readDaemonPidFile(
		context.daemonPidFilePath,
	);
	const baseConfig = context.daemon.control.buildDaemonWebConfig({
		configDir: context.configDir,
		port: context.port,
		accessToken: context.accessToken,
		isCustomConfigDir: context.customConfigDir,
		isDevMode: context.devModeActive,
	});

	if (
		existingPid !== undefined &&
		context.daemon.lifecycle.isProcessRunning(existingPid)
	) {
		return {
			pid: existingPid,
			started: false,
			webConfig: await withNetworkLinks(baseConfig, context.accessToken),
		};
	}

	if (existingPid !== undefined) {
		await context.daemon.lifecycle.cleanupDaemonPidFile(
			context.daemonPidFilePath,
			existingPid,
		);
	}

	const entrypointPath = context.entrypointPath;
	if (!entrypointPath) {
		throw new Error('Unable to start daemon: missing CLI entrypoint path.');
	}

	await mkdir(context.configDir, {recursive: true});
	const daemonProcess = context.daemon.control.spawnDetachedDaemon(
		entrypointPath,
		context.port,
		{
			logFilePath: context.daemonLogPath,
		},
	);
	daemonProcess.unref();

	const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
	const daemonPid = await context.daemon.control.waitForDaemonPid({
		pidFilePath: context.daemonPidFilePath,
		deadline,
		pollIntervalMs: DAEMON_POLL_INTERVAL_MS,
	});

	await context.daemon.control.waitForDaemonApiReady({
		baseUrl: `http://127.0.0.1:${context.port}`,
		accessToken: context.accessToken,
		deadline,
		pollIntervalMs: DAEMON_POLL_INTERVAL_MS,
	});

	return {
		pid: daemonPid,
		started: true,
		webConfig: await withNetworkLinks(baseConfig, context.accessToken),
	};
}

async function stopDaemon(
	context: CliCommandContext,
): Promise<{stopped: boolean; pid?: number}> {
	const pid = await context.daemon.lifecycle.readDaemonPidFile(
		context.daemonPidFilePath,
	);
	if (pid === undefined) {
		return {stopped: false};
	}

	if (!context.daemon.lifecycle.isProcessRunning(pid)) {
		await context.daemon.lifecycle.cleanupDaemonPidFile(
			context.daemonPidFilePath,
			pid,
		);
		return {stopped: false};
	}

	try {
		process.kill(pid, 'SIGTERM');
	} catch (error) {
		const errnoError = error as NodeJS.ErrnoException;
		if (errnoError.code !== 'ESRCH') {
			throw error;
		}
	}

	const deadline = Date.now() + DAEMON_STOP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (!context.daemon.lifecycle.isProcessRunning(pid)) {
			await context.daemon.lifecycle.cleanupDaemonPidFile(
				context.daemonPidFilePath,
				pid,
			);
			return {stopped: true, pid};
		}
		await sleep(DAEMON_POLL_INTERVAL_MS);
	}

	throw new Error(`Timed out waiting for daemon PID ${pid} to stop.`);
}

export async function runDaemonLifecycleCommand(
	context: CliCommandContext,
): Promise<number> {
	if (context.subcommand === 'start') {
		let result: {pid: number; started: boolean; webConfig: DaemonWebConfig};
		try {
			result = await startDaemonInBackground(context);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			context.formatter.writeError({
				text: [`Failed to start daemon: ${message}`],
				data: {
					ok: false,
					command: 'start',
					error: {
						message,
					},
				},
			});
			return 1;
		}

		const lines = formatDaemonVersionHeader(
			result.started ? 'Started' : 'Already running',
		);
		lines.push(`PID:          ${result.pid}`);
		lines.push(`Local URL:    ${result.webConfig.url}`);
		lines.push(
			`External URL: ${result.webConfig.externalUrl || '(unavailable)'}`,
		);
		if (!context.isPortConfigured) {
			lines.push(`Using auto-assigned port: ${result.webConfig.port}`);
		}

		context.formatter.write({
			text: lines,
			data: {
				ok: true,
				command: 'start',
				started: result.started,
				pid: result.pid,
				webConfig: result.webConfig,
				configDir: context.configDir,
				pidFile: context.daemonPidFilePath,
				logFile: context.daemonLogPath,
			},
		});

		if (result.started && result.webConfig.url) {
			openBrowser(result.webConfig.url);
		}

		void checkForUpdate();
		return 0;
	}

	if (context.subcommand === 'stop') {
		let forceStopSummary:
			| {terminated: number; activeSessionIds: string[]}
			| undefined;
		if (context.parsedArgs.flags.force) {
			try {
				forceStopSummary = await terminateActiveSessionsForLifecycle(context);
			} catch (error) {
				const message = normalizeApiError(error).message;
				context.formatter.writeError({
					text: [
						`Failed to stop active sessions before force stop: ${message}`,
						'The daemon was not stopped to avoid ambiguous lifecycle state.',
					],
					data: {
						ok: false,
						command: 'stop',
						force: true,
						error: {message},
					},
				});
				return 1;
			}
		}

		let result: {stopped: boolean; pid?: number};
		try {
			result = await stopDaemon(context);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			context.formatter.writeError({
				text: [`Failed to stop daemon: ${message}`],
				data: {
					ok: false,
					command: 'stop',
					error: {
						message,
					},
				},
			});
			return 1;
		}

		if (!result.stopped) {
			context.formatter.write({
				text: ['No daemon running'],
				data: {
					ok: true,
					command: 'stop',
					stopped: false,
				},
			});
			return 0;
		}

		context.formatter.write({
			text: context.parsedArgs.flags.force
				? [
						`Daemon stopped (PID ${result.pid})`,
						`Force mode: terminated ${forceStopSummary?.terminated || 0} active session(s) before shutdown.`,
						`Sessions terminated: ${formatActiveSessionList(forceStopSummary?.activeSessionIds || [])}`,
					]
				: [
						`Daemon stopped (PID ${result.pid})`,
						'Session recovery mode: active sessions were preserved for next startup.',
						'Use `argusdev stop --force` for destructive shutdown.',
					],
			data: {
				ok: true,
				command: 'stop',
				stopped: true,
				pid: result.pid,
				force: context.parsedArgs.flags.force,
				preservedSessions: !context.parsedArgs.flags.force,
				terminatedSessions: forceStopSummary?.terminated || 0,
				activeSessions: forceStopSummary?.activeSessionIds || [],
			},
		});
		return 0;
	}

	if (context.subcommand === 'status') {
		let statusOutput: {
			running: boolean;
			pid?: number;
			webConfig?: DaemonWebConfig;
			uptime?: string;
		};
		try {
			const pid = await context.daemon.lifecycle.readDaemonPidFile(
				context.daemonPidFilePath,
			);
			if (
				pid === undefined ||
				!context.daemon.lifecycle.isProcessRunning(pid)
			) {
				if (pid !== undefined) {
					await context.daemon.lifecycle.cleanupDaemonPidFile(
						context.daemonPidFilePath,
						pid,
					);
				}
				statusOutput = {running: false};
			} else {
				const baseConfig = context.daemon.control.buildDaemonWebConfig({
					configDir: context.configDir,
					port: context.port,
					accessToken: context.accessToken,
					isCustomConfigDir: context.customConfigDir,
					isDevMode: context.devModeActive,
				});
				statusOutput = {
					running: true,
					pid,
					webConfig: await withNetworkLinks(baseConfig, context.accessToken),
					uptime: getProcessUptime(pid),
				};
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			context.formatter.writeError({
				text: [`Failed to get daemon status: ${message}`],
				data: {
					ok: false,
					command: 'status',
					error: {
						message,
					},
				},
			});
			return 1;
		}

		if (!statusOutput.running) {
			context.formatter.write({
				text: [...formatDaemonVersionHeader('Stopped'), 'Active sessions: 0'],
				data: {
					ok: true,
					command: 'status',
					running: false,
					configDir: context.configDir,
					pidFile: context.daemonPidFilePath,
				},
			});
			return 0;
		}

		const lines = [
			...formatDaemonVersionHeader('Running'),
			`PID:          ${statusOutput.pid}`,
			`Local URL:    ${statusOutput.webConfig?.url}`,
			`External URL: ${statusOutput.webConfig?.externalUrl || '(unavailable)'}`,
		];
		if (statusOutput.uptime) {
			lines.push(`Uptime:       ${statusOutput.uptime}`);
		}

		context.formatter.write({
			text: lines,
			data: {
				ok: true,
				command: 'status',
				running: true,
				pid: statusOutput.pid,
				webConfig: statusOutput.webConfig,
				uptime: statusOutput.uptime,
				configDir: context.configDir,
				pidFile: context.daemonPidFilePath,
				logFile: context.daemonLogPath,
			},
		});
		return 0;
	}

	if (context.subcommand === 'restart') {
		let forceRestartSummary:
			| {terminated: number; activeSessionIds: string[]}
			| undefined;
		if (context.parsedArgs.flags.force) {
			try {
				forceRestartSummary =
					await terminateActiveSessionsForLifecycle(context);
			} catch (error) {
				const message = normalizeApiError(error).message;
				context.formatter.writeError({
					text: [
						`Failed to stop active sessions before force restart: ${message}`,
						'The daemon was not restarted to avoid ambiguous lifecycle state.',
					],
					data: {
						ok: false,
						command: 'restart',
						force: true,
						error: {message},
					},
				});
				return 1;
			}
		}

		let result: {pid: number; started: boolean; webConfig: DaemonWebConfig};
		try {
			await stopDaemon(context);
			result = await startDaemonInBackground(context);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			context.formatter.writeError({
				text: [`Failed to restart daemon: ${message}`],
				data: {
					ok: false,
					command: 'restart',
					error: {
						message,
					},
				},
			});
			return 1;
		}

		context.formatter.write({
			text: [
				...formatDaemonVersionHeader('Restarted'),
				`PID:          ${result.pid}`,
				`Local URL:    ${result.webConfig.url}`,
				`External URL: ${result.webConfig.externalUrl || '(unavailable)'}`,
				...(!context.isPortConfigured
					? [`Using auto-assigned port: ${result.webConfig.port}`]
					: []),
				context.parsedArgs.flags.force
					? `Force mode: terminated ${forceRestartSummary?.terminated || 0} active session(s) before restart.`
					: 'Session recovery mode: active sessions were preserved and will be rehydrated.',
				context.parsedArgs.flags.force
					? `Sessions terminated: ${formatActiveSessionList(forceRestartSummary?.activeSessionIds || [])}`
					: 'Use `argusdev restart --force` for destructive restart.',
			],
			data: {
				ok: true,
				command: 'restart',
				pid: result.pid,
				webConfig: result.webConfig,
				configDir: context.configDir,
				pidFile: context.daemonPidFilePath,
				logFile: context.daemonLogPath,
				force: context.parsedArgs.flags.force,
				preservedSessions: !context.parsedArgs.flags.force,
				terminatedSessions: forceRestartSummary?.terminated || 0,
				activeSessions: forceRestartSummary?.activeSessionIds || [],
			},
		});
		void checkForUpdate();
		return 0;
	}

	context.formatter.writeError({
		text: [`Unknown daemon command: ${context.subcommand}`],
		data: {
			ok: false,
			command: context.subcommand,
			error: {
				message: `Unsupported daemon command: ${context.subcommand}`,
			},
		},
	});
	return 1;
}
