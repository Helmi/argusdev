/* global URL, Request, Response, RequestInit */
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {spawn} from 'child_process';
import path from 'path';
import {fileURLToPath} from 'url';
import {dirname} from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if node-pty native module is available
function isNodePtyAvailable(): boolean {
	try {
		// Use eval to bypass linter's require() check

		new Function('return require("node-pty")')();
		return true;
	} catch {
		return false;
	}
}

describe('CLI', () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = {...process.env};
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('--multi-project flag', () => {
		it.skipIf(!isNodePtyAvailable())(
			'should exit with error when CACD_PROJECTS_DIR is not set',
			async () => {
				// Ensure the env var is not set
				delete process.env['CACD_PROJECTS_DIR'];

				// Create a wrapper script that mocks TTY
				const wrapperScript = `
				process.stdin.isTTY = true;
				process.stdout.isTTY = true;
				process.stderr.isTTY = true;
				process.argv = ['node', 'cli.js', '--multi-project'];
				import('./cli.js');
			`;

				const result = await new Promise<{code: number; stderr: string}>(
					resolve => {
						const proc = spawn(
							'node',
							['--input-type=module', '-e', wrapperScript],
							{
								cwd: path.join(__dirname, '../dist'),
								env: {...process.env},
								stdio: ['pipe', 'pipe', 'pipe'],
							},
						);

						let stderr = '';
						proc.stderr?.on('data', data => {
							stderr += data.toString();
						});

						proc.on('close', code => {
							resolve({code: code ?? 1, stderr});
						});
					},
				);

				expect(result.code).toBe(1);
				expect(result.stderr).toContain(
					'CACD_PROJECTS_DIR environment variable must be set',
				);
				expect(result.stderr).toContain(
					'export CACD_PROJECTS_DIR=/path/to/projects',
				);
			},
		);

		it.skipIf(!isNodePtyAvailable())(
			'should not check for env var when --multi-project is not used',
			async () => {
				// Ensure the env var is not set
				delete process.env['CACD_PROJECTS_DIR'];

				const result = await new Promise<{code: number; stderr: string}>(
					resolve => {
						const cliPath = path.join(__dirname, '../dist/cli.js');
						const proc = spawn('node', [cliPath, '--help'], {
							env: {...process.env},
							stdio: ['pipe', 'pipe', 'pipe'],
						});

						let stderr = '';
						proc.stderr?.on('data', data => {
							stderr += data.toString();
						});

						proc.on('close', code => {
							resolve({code: code ?? 1, stderr});
						});
					},
				);

				expect(result.code).toBe(0);
				expect(result.stderr).not.toContain('CACD_PROJECTS_DIR');
			},
		);
	});

	describe('daemon lifecycle', () => {
		afterEach(() => {
			vi.restoreAllMocks();
			vi.resetModules();
		});

		it('gracefully shuts down daemon on SIGTERM without force-destroying sessions', async () => {
			const originalArgv = [...process.argv];
			process.argv = ['node', '/tmp/unified-entry.tsx', 'daemon'];

			const signalHandlers = new Map<string, () => void>();
			const destroyAllSessions = vi.fn();
			const prepareDaemonPidFile = vi.fn(async () => {});
			const cleanupDaemonPidFile = vi.fn(async () => {});
			const worktreeInitialize = vi.fn();
			const apiStart = vi.fn(async () => ({
				port: 3000,
				address: 'http://0.0.0.0:3000',
			}));
			const socketClose = vi.fn();

			vi.doMock('fs', async importOriginal => {
				const actual = await importOriginal<typeof import('fs')>();
				return {
					...actual,
					existsSync: vi.fn(() => true),
				};
			});

			vi.doMock('dgram', () => ({
				default: {
					createSocket: vi.fn(() => ({
						connect: (_port: number, _host: string, callback: () => void) => {
							callback();
						},
						address: () => ({address: '127.0.0.1', family: 'IPv4', port: 4000}),
						close: socketClose,
						on: vi.fn(),
					})),
				},
			}));

			vi.doMock('dns', () => ({
				default: {
					lookup: vi.fn(
						(
							_hostname: string,
							_options: {family: number},
							callback: (err: null, address: string) => void,
						) => callback(null, '127.0.0.1'),
					),
				},
			}));

			vi.doMock('os', () => ({
				default: {
					hostname: vi.fn(() => 'cacd-host'),
					homedir: vi.fn(() => '/home/user'),
				},
			}));

			vi.doMock('./utils/configDir.js', () => ({
				initializeConfigDir: vi.fn(),
				getConfigDir: vi.fn(() => '/tmp/cacd-test'),
				isCustomConfigDir: vi.fn(() => false),
				isDevModeConfig: vi.fn(() => false),
			}));

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile,
				cleanupDaemonPidFile,
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile: vi.fn(async () => undefined),
				isProcessRunning: vi.fn(() => false),
			}));

			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			vi.doMock('./services/projectManager.js', () => ({
				projectManager: {
					addProject: vi.fn(),
					removeProject: vi.fn(),
					getProjects: vi.fn(() => []),
					instance: {validateProjects: vi.fn()},
				},
			}));

			vi.doMock('./services/worktreeConfigManager.js', () => ({
				worktreeConfigManager: {
					initialize: worktreeInitialize,
				},
			}));

			vi.doMock('./services/configurationManager.js', () => ({
				configurationManager: {
					getConfiguration: vi.fn(() => ({accessToken: 'token'})),
					getPort: vi.fn(() => 3000),
					setPort: vi.fn(),
				},
			}));

			vi.doMock('./services/globalSessionOrchestrator.js', () => ({
				globalSessionOrchestrator: {
					destroyAllSessions,
				},
			}));

			vi.doMock('./services/apiServer.js', () => ({
				apiServer: {
					start: apiStart,
				},
			}));

			vi.doMock('./constants/env.js', () => ({
				ENV_VARS: {PORT: 'CACD_PORT'},
				generateRandomPort: vi.fn(() => 3010),
			}));

			const processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
				event: string,
				handler: () => void,
			) => {
				signalHandlers.set(event, handler);
				return process;
			}) as typeof process.on);
			const processExitSpy = vi
				.spyOn(process, 'exit')
				.mockImplementation((() => undefined) as never);

			const consoleLogSpy = vi
				.spyOn(console, 'log')
				.mockImplementation(() => {});

			try {
				await import('./cli.js');

				expect(apiStart).toHaveBeenCalledWith(3000, '0.0.0.0', false);
				expect(prepareDaemonPidFile).toHaveBeenCalledWith(
					'/tmp/cacd-test/daemon.pid',
					process.pid,
				);
				expect(signalHandlers.get('SIGTERM')).toBeTypeOf('function');

				signalHandlers.get('SIGTERM')?.();
				await new Promise(resolve => {
					setTimeout(resolve, 0);
				});

				expect(destroyAllSessions).not.toHaveBeenCalled();
				expect(cleanupDaemonPidFile).toHaveBeenCalledWith(
					'/tmp/cacd-test/daemon.pid',
					process.pid,
				);
				expect(processExitSpy).toHaveBeenCalledWith(0);
				expect(worktreeInitialize).toHaveBeenCalledTimes(1);
				expect(socketClose).toHaveBeenCalledTimes(1);
				expect(consoleLogSpy).toHaveBeenCalled();
			} finally {
				processOnSpy.mockRestore();
				processExitSpy.mockRestore();
				consoleLogSpy.mockRestore();
				process.argv = originalArgv;
			}
		});
	});

	describe('unified entrypoint', () => {
		const originalArgv = [...process.argv];
		const originalStdinIsTTY = process.stdin.isTTY;
		const originalStdoutIsTTY = process.stdout.isTTY;

		const setupCommonMocks = () => {
			vi.doMock('fs', async importOriginal => {
				const actual = await importOriginal<typeof import('fs')>();
				return {
					...actual,
					existsSync: vi.fn(() => true),
				};
			});
			vi.doMock('fs/promises', async importOriginal => {
				const actual = await importOriginal<typeof import('fs/promises')>();
				return {
					...actual,
					mkdir: vi.fn(async () => {}),
				};
			});
			vi.doMock('child_process', async importOriginal => {
				const actual = await importOriginal<typeof import('child_process')>();
				return {
					...actual,
					spawnSync: vi.fn(() => ({status: 0, stdout: '00:02:00\n'})),
				};
			});
			vi.doMock('dgram', () => ({
				default: {
					createSocket: vi.fn(() => ({
						connect: (_port: number, _host: string, callback: () => void) => {
							callback();
						},
						address: () => ({address: '192.168.0.10', family: 'IPv4', port: 0}),
						close: vi.fn(),
						on: vi.fn(),
					})),
				},
			}));
			vi.doMock('dns', () => ({
				default: {
					lookup: vi.fn(
						(
							_hostname: string,
							_options: {family: number},
							callback: (err: null, address: string) => void,
						) => callback(null, '192.168.0.10'),
					),
				},
			}));
			vi.doMock('os', () => ({
				default: {
					hostname: vi.fn(() => 'cacd-host'),
					homedir: vi.fn(() => '/home/user'),
				},
			}));
			vi.doMock('./utils/configDir.js', () => ({
				initializeConfigDir: vi.fn(),
				getConfigDir: vi.fn(() => '/tmp/cacd-test'),
				isCustomConfigDir: vi.fn(() => false),
				isDevModeConfig: vi.fn(() => false),
			}));
			vi.doMock('./services/projectManager.js', () => ({
				projectManager: {
					addProject: vi.fn(),
					removeProject: vi.fn(),
					getProjects: vi.fn(() => []),
					instance: {validateProjects: vi.fn()},
				},
			}));
			vi.doMock('./services/worktreeConfigManager.js', () => ({
				worktreeConfigManager: {
					initialize: vi.fn(),
				},
			}));
			vi.doMock('./services/configurationManager.js', () => ({
				configurationManager: {
					getConfiguration: vi.fn(() => ({accessToken: 'token'})),
					getPort: vi.fn(() => 3000),
					setPort: vi.fn(),
				},
			}));
			vi.doMock('./services/globalSessionOrchestrator.js', () => ({
				globalSessionOrchestrator: {
					destroyAllSessions: vi.fn(),
				},
			}));
			vi.doMock('./services/apiServer.js', () => ({
				apiServer: {
					start: vi.fn(async () => ({
						port: 3000,
						address: 'http://0.0.0.0:3000',
					})),
				},
			}));
			vi.doMock('./constants/env.js', () => ({
				ENV_VARS: {PORT: 'CACD_PORT'},
				generateRandomPort: vi.fn(() => 3010),
			}));
		};

		afterEach(() => {
			process.argv = [...originalArgv];
			Object.defineProperty(process.stdin, 'isTTY', {
				value: originalStdinIsTTY,
				configurable: true,
			});
			Object.defineProperty(process.stdout, 'isTTY', {
				value: originalStdoutIsTTY,
				configurable: true,
			});
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
			vi.resetModules();
		});

		it('treats bare `cacd` as `cacd start`', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx'];
			setupCommonMocks();

			const readDaemonPidFile = vi.fn(async () => undefined);
			const isProcessRunning = vi.fn(() => false);
			const cleanupDaemonPidFile = vi.fn(async () => {});
			const spawnDetachedDaemon = vi.fn(() => ({pid: 4242, unref: vi.fn()}));
			const waitForDaemonPid = vi.fn(async () => 4242);
			const waitForDaemonApiReady = vi.fn(async () => {});
			const ensureDaemonForTui = vi.fn();
			const buildDaemonWebConfig = vi.fn(() => ({
				url: 'http://127.0.0.1:3000/token',
				port: 3000,
				configDir: '/tmp/cacd-test',
				isCustomConfigDir: false,
				isDevMode: false,
			}));

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile,
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile,
				isProcessRunning,
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig,
				ensureDaemonForTui,
				spawnDetachedDaemon,
				waitForDaemonPid,
				waitForDaemonApiReady,
			}));

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(spawnDetachedDaemon).toHaveBeenCalledWith(
					'/tmp/unified-entry.tsx',
					3000,
					{logFilePath: path.join('/tmp/cacd-test', 'daemon.log')},
				);
				expect(waitForDaemonPid).toHaveBeenCalled();
				expect(waitForDaemonApiReady).toHaveBeenCalledWith({
					baseUrl: 'http://127.0.0.1:3000',
					accessToken: 'token',
					deadline: expect.any(Number),
					pollIntervalMs: 200,
				});
				expect(ensureDaemonForTui).not.toHaveBeenCalled();
			} finally {
				processExitSpy.mockRestore();
			}
		});

		it('starts daemon for explicit `cacd start`', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx', 'start'];
			setupCommonMocks();

			const readDaemonPidFile = vi.fn(async () => undefined);
			const isProcessRunning = vi.fn(() => false);
			const cleanupDaemonPidFile = vi.fn(async () => {});
			const spawnDetachedDaemon = vi.fn(() => ({pid: 7777, unref: vi.fn()}));
			const waitForDaemonPid = vi.fn(async () => 7777);
			const waitForDaemonApiReady = vi.fn(async () => {});
			const buildDaemonWebConfig = vi.fn(() => ({
				url: 'http://127.0.0.1:3000/token',
				port: 3000,
				configDir: '/tmp/cacd-test',
				isCustomConfigDir: false,
				isDevMode: false,
			}));

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile,
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile,
				isProcessRunning,
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig,
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon,
				waitForDaemonPid,
				waitForDaemonApiReady,
			}));

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(processExitSpy).toHaveBeenCalledWith(0);
				expect(spawnDetachedDaemon).toHaveBeenCalledWith(
					'/tmp/unified-entry.tsx',
					3000,
					{logFilePath: path.join('/tmp/cacd-test', 'daemon.log')},
				);
			} finally {
				processExitSpy.mockRestore();
			}
		});

		it('stops daemon with SIGTERM and cleans PID file', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx', 'stop'];
			setupCommonMocks();

			const readDaemonPidFile = vi.fn(async () => 4242);
			const isProcessRunning = vi
				.fn()
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(false);
			const cleanupDaemonPidFile = vi.fn(async () => {});

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile,
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile,
				isProcessRunning,
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const processKillSpy = vi
				.spyOn(process, 'kill')
				.mockImplementation((() => true) as never);
			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(processKillSpy).toHaveBeenCalledWith(4242, 'SIGTERM');
				expect(cleanupDaemonPidFile).toHaveBeenCalledWith(
					'/tmp/cacd-test/daemon.pid',
					4242,
				);
			} finally {
				processKillSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it('stops daemon with --force and terminates active sessions first', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx', 'stop', '--force'];
			setupCommonMocks();

			const readDaemonPidFile = vi.fn(async () => 4242);
			const isProcessRunning = vi
				.fn()
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(false);
			const cleanupDaemonPidFile = vi.fn(async () => {});
			const fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
				const url = String(input);
				if (url.endsWith('/api/sessions')) {
					return new Response(
						JSON.stringify([{id: 'session-1'}, {id: 'session-2'}]),
						{
							status: 200,
							headers: {'content-type': 'application/json'},
						},
					);
				}
				if (url.endsWith('/api/session/stop')) {
					const payload = JSON.parse(String(init?.body || '{}')) as {
						id?: string;
					};
					expect(['session-1', 'session-2']).toContain(payload.id);
					return new Response(JSON.stringify({success: true}), {
						status: 200,
						headers: {'content-type': 'application/json'},
					});
				}
				throw new Error(`Unexpected fetch URL: ${url}`);
			});
			vi.stubGlobal('fetch', fetchSpy as typeof globalThis.fetch);

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile,
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile,
				isProcessRunning,
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const processKillSpy = vi
				.spyOn(process, 'kill')
				.mockImplementation((() => true) as never);
			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(fetchSpy).toHaveBeenCalledTimes(3);
				expect(processKillSpy).toHaveBeenCalledWith(4242, 'SIGTERM');
				expect(cleanupDaemonPidFile).toHaveBeenCalledWith(
					'/tmp/cacd-test/daemon.pid',
					4242,
				);
			} finally {
				processKillSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it('reports running daemon status', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx', 'status'];
			setupCommonMocks();

			const readDaemonPidFile = vi.fn(async () => 5151);
			const isProcessRunning = vi.fn(() => true);
			const buildDaemonWebConfig = vi.fn(() => ({
				url: 'http://127.0.0.1:3000/token',
				port: 3000,
				configDir: '/tmp/cacd-test',
				isCustomConfigDir: false,
				isDevMode: false,
			}));

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile,
				isProcessRunning,
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig,
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);
			const consoleLogSpy = vi
				.spyOn(console, 'log')
				.mockImplementation(() => {});

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(consoleLogSpy).toHaveBeenCalledWith('Daemon is running');
				expect(consoleLogSpy).toHaveBeenCalledWith('PID:          5151');
				expect(consoleLogSpy).toHaveBeenCalledWith('Uptime:       00:02:00');
			} finally {
				processExitSpy.mockRestore();
				consoleLogSpy.mockRestore();
			}
		});

		it('reports stopped daemon status', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx', 'status'];
			setupCommonMocks();

			const readDaemonPidFile = vi.fn(async () => undefined);

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile,
				isProcessRunning: vi.fn(() => false),
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);
			const consoleLogSpy = vi
				.spyOn(console, 'log')
				.mockImplementation(() => {});

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(consoleLogSpy).toHaveBeenCalledWith('Daemon is not running');
			} finally {
				processExitSpy.mockRestore();
				consoleLogSpy.mockRestore();
			}
		});

		it('restarts daemon by stopping then starting', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx', 'restart'];
			setupCommonMocks();

			const readDaemonPidFile = vi
				.fn<(_: string) => Promise<number | undefined>>()
				.mockResolvedValueOnce(4242)
				.mockResolvedValueOnce(undefined);
			const isProcessRunning = vi
				.fn()
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(false);
			const cleanupDaemonPidFile = vi.fn(async () => {});
			const spawnDetachedDaemon = vi.fn(() => ({pid: 9090, unref: vi.fn()}));
			const waitForDaemonPid = vi.fn(async () => 9090);
			const waitForDaemonApiReady = vi.fn(async () => {});

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile,
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile,
				isProcessRunning,
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(() => ({
					url: 'http://127.0.0.1:3000/token',
					port: 3000,
					configDir: '/tmp/cacd-test',
					isCustomConfigDir: false,
					isDevMode: false,
				})),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon,
				waitForDaemonPid,
				waitForDaemonApiReady,
			}));

			const processKillSpy = vi
				.spyOn(process, 'kill')
				.mockImplementation((() => true) as never);
			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(processKillSpy).toHaveBeenCalledWith(4242, 'SIGTERM');
				expect(spawnDetachedDaemon).toHaveBeenCalledWith(
					'/tmp/unified-entry.tsx',
					3000,
					{logFilePath: path.join('/tmp/cacd-test', 'daemon.log')},
				);
			} finally {
				processKillSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it('restarts daemon with --force after terminating active sessions', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx', 'restart', '--force'];
			setupCommonMocks();

			const readDaemonPidFile = vi
				.fn<(_: string) => Promise<number | undefined>>()
				.mockResolvedValueOnce(4242)
				.mockResolvedValueOnce(undefined);
			const isProcessRunning = vi
				.fn()
				.mockReturnValueOnce(true)
				.mockReturnValueOnce(false);
			const cleanupDaemonPidFile = vi.fn(async () => {});
			const spawnDetachedDaemon = vi.fn(() => ({pid: 9090, unref: vi.fn()}));
			const waitForDaemonPid = vi.fn(async () => 9090);
			const waitForDaemonApiReady = vi.fn(async () => {});
			const fetchSpy = vi.fn(async (input: unknown, init?: RequestInit) => {
				const url = String(input);
				if (url.endsWith('/api/sessions')) {
					return new Response(JSON.stringify([{id: 'session-1'}]), {
						status: 200,
						headers: {'content-type': 'application/json'},
					});
				}
				if (url.endsWith('/api/session/stop')) {
					const payload = JSON.parse(String(init?.body || '{}')) as {
						id?: string;
					};
					expect(payload.id).toBe('session-1');
					return new Response(JSON.stringify({success: true}), {
						status: 200,
						headers: {'content-type': 'application/json'},
					});
				}
				throw new Error(`Unexpected fetch URL: ${url}`);
			});
			vi.stubGlobal('fetch', fetchSpy as typeof globalThis.fetch);

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile,
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile,
				isProcessRunning,
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(() => ({
					url: 'http://127.0.0.1:3000/token',
					port: 3000,
					configDir: '/tmp/cacd-test',
					isCustomConfigDir: false,
					isDevMode: false,
				})),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon,
				waitForDaemonPid,
				waitForDaemonApiReady,
			}));

			const processKillSpy = vi
				.spyOn(process, 'kill')
				.mockImplementation((() => true) as never);
			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(fetchSpy).toHaveBeenCalledTimes(2);
				expect(processKillSpy).toHaveBeenCalledWith(4242, 'SIGTERM');
				expect(spawnDetachedDaemon).toHaveBeenCalledWith(
					'/tmp/unified-entry.tsx',
					3000,
					{logFilePath: path.join('/tmp/cacd-test', 'daemon.log')},
				);
			} finally {
				processKillSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it('keeps `cacd tui` daemon-required behavior', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx', 'tui'];
			Object.defineProperty(process.stdin, 'isTTY', {
				value: true,
				configurable: true,
			});
			Object.defineProperty(process.stdout, 'isTTY', {
				value: true,
				configurable: true,
			});
			setupCommonMocks();

			const ensureDaemonForTui = vi.fn(async () => {
				throw new Error('No running CA⚡CD daemon found');
			});

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile: vi.fn(),
				isProcessRunning: vi.fn(),
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui,
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const consoleErrorSpy = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});
			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:1');
				expect(ensureDaemonForTui).toHaveBeenCalledWith({
					configDir: '/tmp/cacd-test',
					port: 3000,
					accessToken: 'token',
					isCustomConfigDir: false,
					isDevMode: false,
					autoStart: false,
				});
				expect(consoleErrorSpy).toHaveBeenCalledWith(
					'Failed to connect TUI to daemon: No running CA⚡CD daemon found',
				);
			} finally {
				consoleErrorSpy.mockRestore();
				processExitSpy.mockRestore();
			}
		});

		it('supports `cacd status --sessions --json`', async () => {
			process.argv = [
				'node',
				'/tmp/unified-entry.tsx',
				'status',
				'--sessions',
				'--json',
			];
			setupCommonMocks();

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile: vi.fn(async () => 5151),
				isProcessRunning: vi.fn(() => true),
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(() => ({
					url: 'http://127.0.0.1:3000/token',
					port: 3000,
					configDir: '/tmp/cacd-test',
					isCustomConfigDir: false,
					isDevMode: false,
				})),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const fetchMock = vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				if (url.endsWith('/api/sessions')) {
					return new Response(
						JSON.stringify([
							{
								id: 'session-1',
								path: '/repo/.worktrees/feat-a',
								state: 'busy',
								isActive: true,
								agentId: 'codex',
								pid: 9001,
							},
						]),
						{status: 200},
					);
				}

				if (url.endsWith('/api/conversations/session-1')) {
					return new Response(
						JSON.stringify({
							session: {
								id: 'session-1',
								agentProfileName: 'Codex',
								agentOptions: {model: 'gpt-5'},
								worktreePath: '/repo/.worktrees/feat-a',
								branchName: 'feat-a',
								tdTaskId: 'td-123',
								createdAt: Math.floor(Date.now() / 1000) - 60,
								state: 'busy',
								isActive: true,
							},
						}),
						{status: 200},
					);
				}

				return new Response('{}', {status: 404});
			});
			vi.stubGlobal('fetch', fetchMock);

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);
			const consoleLogSpy = vi
				.spyOn(console, 'log')
				.mockImplementation(() => {});

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				const output = consoleLogSpy.mock.calls
					.map(call => String(call[0]))
					.join('\n');
				expect(output).toContain('"running": true');
				expect(output).toContain('"sessions"');
				expect(output).toContain('"model": "gpt-5"');
			} finally {
				processExitSpy.mockRestore();
				consoleLogSpy.mockRestore();
			}
		});

		it('supports `cacd sessions show <id>`', async () => {
			process.argv = [
				'node',
				'/tmp/unified-entry.tsx',
				'sessions',
				'show',
				'session-1',
			];
			setupCommonMocks();

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile: vi.fn(),
				isProcessRunning: vi.fn(),
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const fetchMock = vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				if (url.endsWith('/api/sessions')) {
					return new Response(
						JSON.stringify([
							{
								id: 'session-1',
								path: '/repo/.worktrees/feat-a',
								state: 'waiting_input',
								isActive: true,
								agentId: 'codex',
								pid: 7331,
							},
						]),
						{status: 200},
					);
				}

				if (url.endsWith('/api/conversations/session-1')) {
					return new Response(
						JSON.stringify({
							session: {
								id: 'session-1',
								agentProfileName: 'Codex',
								agentOptions: {model: 'gpt-5'},
								worktreePath: '/repo/.worktrees/feat-a',
								branchName: 'feat-a',
								tdTaskId: 'td-555',
								createdAt: Math.floor(Date.now() / 1000) - 180,
								state: 'waiting_input',
								isActive: true,
							},
						}),
						{status: 200},
					);
				}

				return new Response('{}', {status: 404});
			});
			vi.stubGlobal('fetch', fetchMock);

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);
			const consoleLogSpy = vi
				.spyOn(console, 'log')
				.mockImplementation(() => {});

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(consoleLogSpy).toHaveBeenCalledWith('ID:        session-1');
				expect(consoleLogSpy).toHaveBeenCalledWith('Model:     gpt-5');
				expect(consoleLogSpy).toHaveBeenCalledWith('Branch:    feat-a');
				expect(consoleLogSpy).toHaveBeenCalledWith('Status:    waiting_input');
				expect(consoleLogSpy).toHaveBeenCalledWith('PID:       7331');
			} finally {
				processExitSpy.mockRestore();
				consoleLogSpy.mockRestore();
			}
		});

		it('supports `cacd session create --agent <id>`', async () => {
			process.argv = [
				'node',
				'/tmp/unified-entry.tsx',
				'session',
				'create',
				'--agent',
				'codex',
				'--worktree',
				'/repo/.worktrees/feat-a',
				'--model',
				'gpt-5',
				'--task',
				'td-555',
				'--name',
				'Feature A',
				'--intent',
				'work',
				'--option',
				'yolo',
				'--json',
			];
			setupCommonMocks();

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile: vi.fn(),
				isProcessRunning: vi.fn(),
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const fetchMock = vi.fn(
				async (input: string | URL | Request, init?: RequestInit) => {
					const url = String(input);
					if (url.endsWith('/api/session/create-with-agent')) {
						const payload = JSON.parse(String(init?.body || '{}')) as {
							agentId: string;
							path: string;
							options: Record<string, boolean | string>;
							tdTaskId?: string;
							sessionName?: string;
							intent?: string;
						};
						expect(payload.agentId).toBe('codex');
						expect(payload.path).toBe('/repo/.worktrees/feat-a');
						expect(payload.options).toEqual({model: 'gpt-5', yolo: true});
						expect(payload.tdTaskId).toBe('td-555');
						expect(payload.sessionName).toBe('Feature A');
						expect(payload.intent).toBe('work');

						return new Response(
							JSON.stringify({
								success: true,
								id: 'session-42',
								name: 'Feature A',
								agentId: 'codex',
							}),
							{status: 200},
						);
					}

					return new Response('{}', {status: 404});
				},
			);
			vi.stubGlobal('fetch', fetchMock);

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);
			const consoleLogSpy = vi
				.spyOn(console, 'log')
				.mockImplementation(() => {});

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				const output = consoleLogSpy.mock.calls
					.map(call => String(call[0]))
					.join('\n');
				expect(output).toContain('"command": "session create"');
				expect(output).toContain('"id": "session-42"');
			} finally {
				processExitSpy.mockRestore();
				consoleLogSpy.mockRestore();
			}
		});

		it('supports `cacd session status <id>`', async () => {
			process.argv = [
				'node',
				'/tmp/unified-entry.tsx',
				'session',
				'status',
				'session-1',
			];
			setupCommonMocks();

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile: vi.fn(),
				isProcessRunning: vi.fn(),
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const fetchMock = vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				if (url.endsWith('/api/sessions')) {
					return new Response(
						JSON.stringify([
							{
								id: 'session-1',
								path: '/repo/.worktrees/feat-a',
								state: 'busy',
								isActive: true,
								agentId: 'codex',
								pid: 1234,
							},
						]),
						{status: 200},
					);
				}

				if (url.endsWith('/api/conversations/session-1')) {
					return new Response(
						JSON.stringify({
							session: {
								id: 'session-1',
								agentProfileName: 'Codex',
								agentOptions: {model: 'gpt-5'},
								worktreePath: '/repo/.worktrees/feat-a',
								branchName: 'feat-a',
								tdTaskId: 'td-123',
								createdAt: Math.floor(Date.now() / 1000) - 120,
								state: 'busy',
								isActive: true,
							},
						}),
						{status: 200},
					);
				}

				return new Response('{}', {status: 404});
			});
			vi.stubGlobal('fetch', fetchMock);

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);
			const consoleLogSpy = vi
				.spyOn(console, 'log')
				.mockImplementation(() => {});

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				expect(consoleLogSpy).toHaveBeenCalledWith('ID:        session-1');
				expect(consoleLogSpy).toHaveBeenCalledWith('Status:    busy');
				expect(consoleLogSpy).toHaveBeenCalledWith('PID:       1234');
			} finally {
				processExitSpy.mockRestore();
				consoleLogSpy.mockRestore();
			}
		});

		it('supports `cacd session stop <id> --json`', async () => {
			process.argv = [
				'node',
				'/tmp/unified-entry.tsx',
				'session',
				'stop',
				'session-9',
				'--json',
			];
			setupCommonMocks();

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile: vi.fn(),
				isProcessRunning: vi.fn(),
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const fetchMock = vi.fn(
				async (input: string | URL | Request, init?: RequestInit) => {
					const url = String(input);
					if (url.endsWith('/api/session/stop')) {
						const payload = JSON.parse(String(init?.body || '{}')) as {
							id: string;
						};
						expect(payload.id).toBe('session-9');
						return new Response(JSON.stringify({success: true}), {status: 200});
					}
					return new Response('{}', {status: 404});
				},
			);
			vi.stubGlobal('fetch', fetchMock);

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);
			const consoleLogSpy = vi
				.spyOn(console, 'log')
				.mockImplementation(() => {});

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				const output = consoleLogSpy.mock.calls
					.map(call => String(call[0]))
					.join('\n');
				expect(output).toContain('"command": "session stop"');
				expect(output).toContain('"stopped": true');
			} finally {
				processExitSpy.mockRestore();
				consoleLogSpy.mockRestore();
			}
		});

		it('supports `cacd agents list --json`', async () => {
			process.argv = [
				'node',
				'/tmp/unified-entry.tsx',
				'agents',
				'list',
				'--json',
			];
			setupCommonMocks();

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile: vi.fn(),
				isProcessRunning: vi.fn(),
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const fetchMock = vi.fn(async (input: string | URL | Request) => {
				const url = String(input);
				if (url.includes('/api/agents?includeDisabled=true')) {
					return new Response(
						JSON.stringify({
							agents: [
								{id: 'codex', name: 'Codex', kind: 'agent', enabled: true},
								{id: 'claude', name: 'Claude', kind: 'agent', enabled: false},
							],
							defaultAgentId: 'codex',
							schemaVersion: 1,
						}),
						{status: 200},
					);
				}

				if (url.endsWith('/api/sessions')) {
					return new Response(
						JSON.stringify([
							{
								id: 'session-1',
								path: '/repo/.worktrees/feat-a',
								state: 'busy',
								isActive: true,
								agentId: 'codex',
								pid: 1010,
							},
						]),
						{status: 200},
					);
				}

				return new Response('{}', {status: 404});
			});
			vi.stubGlobal('fetch', fetchMock);

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);
			const consoleLogSpy = vi
				.spyOn(console, 'log')
				.mockImplementation(() => {});

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:0');
				const output = consoleLogSpy.mock.calls
					.map(call => String(call[0]))
					.join('\n');
				expect(output).toContain('"id": "codex"');
				expect(output).toContain('"isDefault": true');
				expect(output).toContain('"state": "busy"');
			} finally {
				processExitSpy.mockRestore();
				consoleLogSpy.mockRestore();
			}
		});

		it('gracefully handles daemon not running for query commands', async () => {
			process.argv = ['node', '/tmp/unified-entry.tsx', 'sessions', 'list'];
			setupCommonMocks();

			vi.doMock('./utils/daemonLifecycle.js', () => ({
				prepareDaemonPidFile: vi.fn(),
				cleanupDaemonPidFile: vi.fn(),
				getDaemonPidFilePath: vi.fn(() => '/tmp/cacd-test/daemon.pid'),
				readDaemonPidFile: vi.fn(),
				isProcessRunning: vi.fn(),
			}));
			vi.doMock('./utils/daemonControl.js', () => ({
				buildDaemonWebConfig: vi.fn(),
				ensureDaemonForTui: vi.fn(),
				spawnDetachedDaemon: vi.fn(),
				waitForDaemonPid: vi.fn(),
				waitForDaemonApiReady: vi.fn(),
			}));

			const fetchError = new TypeError('fetch failed') as TypeError & {
				cause?: {code: string};
			};
			fetchError.cause = {code: 'ECONNREFUSED'};
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => Promise.reject(fetchError)),
			);

			const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(((
				code?: number,
			) => {
				throw new Error(`exit:${code ?? 0}`);
			}) as never);
			const consoleErrorSpy = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});

			try {
				await expect(import('./cli.js')).rejects.toThrow('exit:1');
				expect(consoleErrorSpy).toHaveBeenCalledWith(
					'Failed to query sessions: No running CA⚡CD daemon found. Start it with `cacd start`.',
				);
			} finally {
				processExitSpy.mockRestore();
				consoleErrorSpy.mockRestore();
			}
		});
	});
});
