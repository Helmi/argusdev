#!/usr/bin/env node
// IMPORTANT: Initialize config dir BEFORE any service imports
// This must be at the very top to ensure singletons use the correct path
import {
	initializeConfigDir,
	getConfigDir,
	isCustomConfigDir,
	isDevModeConfig,
} from './utils/configDir.js';
import {existsSync} from 'fs';
import dgram from 'dgram';
import dns from 'dns';
import os from 'os';
import {join} from 'path';
import {
	cleanupDaemonPidFile,
	getDaemonPidFilePath,
	isProcessRunning,
	prepareDaemonPidFile,
	readDaemonPidFile,
} from './utils/daemonLifecycle.js';
import {
	buildDaemonWebConfig,
	ensureDaemonForTui,
	spawnDetachedDaemon,
	waitForDaemonApiReady,
	waitForDaemonPid,
	type DaemonWebConfig,
} from './utils/daemonControl.js';
import {OutputFormatter} from './cli/formatter.js';
import {
	runRegisteredCommand,
	getRegisteredCommands,
} from './cli/commands/index.js';
import {runSetupCommand} from './cli/commands/setup.js';
import type {
	CliCommandContext,
	CliFlags,
	CliRuntimeServices,
} from './cli/types.js';

// Initialize config dir immediately - this is safe because configDir.js has no dependencies
initializeConfigDir();

// Check for first-run BEFORE importing services that auto-create config
const configDir = getConfigDir();
const configPath = join(configDir, 'config.json');
const isFirstRun = !existsSync(configPath);

// Parse CLI args early to check for setup subcommand
const {default: meow} = await import('meow');

const cli = meow(
	`
  Usage
    $ argusdev                      Start daemon in background
    $ argusdev start                Start daemon in background
    $ argusdev stop [--force]       Stop daemon (preserve sessions by default)
    $ argusdev status               Show daemon status
    $ argusdev status --sessions    Show daemon status and active sessions
    $ argusdev sessions list        List active sessions (legacy)
    $ argusdev sessions show <id>   Show one active session (legacy)
    $ argusdev session create --agent <id> [--worktree <path>] [--model <name>]
    $ argusdev session list         List active sessions
    $ argusdev session status <id>  Show one active session
    $ argusdev session stop <id>    Stop a running session
    $ argusdev agents list          List agents and their active sessions
    $ argusdev ui focus <id>        Set active/focused session in WebUI state
    $ argusdev ui send <id> <msg>   UI hook stub (not yet supported by daemon API)
    $ argusdev ui approve <id>      UI hook stub (not yet supported by daemon API)
    $ argusdev ui notify <msg>      UI hook stub (not yet supported by daemon API)
    $ argusdev focus <id>           Alias for argusdev ui focus <id>
    $ argusdev send <id> <msg>      Alias for argusdev ui send ... (stub)
    $ argusdev approve <id>         Alias for argusdev ui approve ... (stub)
    $ argusdev notify <msg>         Alias for argusdev ui notify ... (stub)
    $ argusdev restart [--force]    Restart daemon (preserve sessions by default)
    $ argusdev tui                  Launch TUI (daemon must already be running)
    $ argusdev daemon               Run daemon in foreground (for service managers)
    $ argusdev setup                Run first-time setup wizard
    $ argusdev add [path]           Add a project (alias for 'argusdev project add')
    $ argusdev remove <path>        Remove a project (alias for 'argusdev project remove')
    $ argusdev list                 List projects (alias for 'argusdev project list')
    $ argusdev project add [path]   Add a project
    $ argusdev project list         List tracked projects
    $ argusdev project remove <path> Remove a project
    $ argusdev project configure <path> [--name <name>] [--description <desc>]
    $ argusdev worktree <command>   Manage worktrees through daemon API
    $ argusdev auth <command>       Manage WebUI authentication

  Auth Commands
    $ argusdev auth show              Display access URL
    $ argusdev auth reset-passcode    Reset your passcode
    $ argusdev auth regenerate-token  Generate new access token (careful!)

  Worktree Commands
    $ argusdev worktree create [--branch <name>] [--project <path>] [--task <td-task-id>]
    $ argusdev worktree list [--project <path>]
    $ argusdev worktree delete <path>
    $ argusdev worktree merge <path> [--target <branch>]

  Options
    --help                  Show help
    --version               Show version
    --port <number>         Port for web interface (overrides config/env)
    --headless              Run API server only (legacy alias for 'daemon')
    --sessions              Include active sessions in status output
    --devc-up-command       Command to start devcontainer
    --devc-exec-command     Command to execute in devcontainer
    --json                  Output machine-readable JSON for query/worktree/project commands
    --branch <name>         Branch name for worktree create
    --task <td-task-id>     Task id used as branch fallback for worktree create
    --target <branch>       Target branch for worktree merge
    --name <name>           Project name (for 'argusdev project configure')
    --description <desc>    Project description (for 'argusdev project configure')

  Session Create Options (for 'argusdev session create')
    --agent <id>            Agent profile ID (required)
    --worktree <path>       Worktree path (defaults to current directory)
    --model <name>          Convenience alias for option "model"
    --task <td-task-id>     Link session to TD task ID
    --name <name>           Session name
    --task-list <name>      Claude task list name
    --prompt-template <name> TD prompt template name
    --intent <intent>       Session intent: work | review | manual
    --option <key[=value]>  Agent option (repeatable, e.g. --option yolo --option model=gpt-5)

  Setup Options (for 'argusdev setup')
    --no-web               Disable web interface
    --project <path>       Add specified path as first project
    --skip-project         Don't add any project
    --force                Setup: overwrite config. Daemon stop/restart: destructive session shutdown.

  Environment Variables
    ARGUSDEV_CONFIG_DIR        Custom config directory (highest priority, overrides ARGUSDEV_DEV)
    ARGUSDEV_PORT              Port for web interface
    ARGUSDEV_DEV               Set to 1 for dev mode (uses local .argusdev-dev/ config)

  Examples
    $ argusdev                        # Start daemon in background
    $ argusdev start                  # Start daemon in background
    $ argusdev status                 # Check daemon status
    $ argusdev status --sessions      # Show daemon + active sessions
    $ argusdev sessions list          # List active sessions (legacy)
    $ argusdev sessions show session-123
    $ argusdev session create --agent codex --worktree . --model gpt-5
    $ argusdev session list
    $ argusdev session status session-123
    $ argusdev session stop session-123
    $ argusdev agents list --json
    $ argusdev ui focus session-123   # Set focused session in UI/daemon state
    $ argusdev focus session-123      # Alias for ui focus
    $ argusdev stop                   # Stop daemon and preserve sessions for recovery
    $ argusdev stop --force           # Stop daemon and terminate active sessions
    $ argusdev tui                    # Launch TUI (requires running daemon)
    $ argusdev daemon                 # Foreground daemon mode for systemd/launchd
    $ argusdev setup --port 8080      # Setup with custom port
    $ argusdev add                    # Add current directory as project
    $ argusdev add /path/to/project   # Add specific project
    $ argusdev list                   # Show tracked projects
    $ argusdev project list           # Show tracked projects
    $ argusdev project configure /path/to/project --name "My Project"
    $ argusdev worktree list          # List registered worktrees
    $ argusdev worktree merge /path/to/worktree --target main
    $ argusdev auth show              # Show WebUI access URL
	`,
	{
		importMeta: import.meta,
		flags: {
			port: {
				type: 'number',
			},
			headless: {
				type: 'boolean',
				default: false,
			},
			sessions: {
				type: 'boolean',
				default: false,
			},
			devcUpCommand: {
				type: 'string',
			},
			devcExecCommand: {
				type: 'string',
			},
			json: {
				type: 'boolean',
				default: false,
			},
			// Session/project/worktree flags
			agent: {
				type: 'string',
			},
			model: {
				type: 'string',
			},
			worktree: {
				type: 'string',
			},
			task: {
				type: 'string',
			},
			name: {
				type: 'string',
			},
			taskList: {
				type: 'string',
			},
			promptTemplate: {
				type: 'string',
			},
			intent: {
				type: 'string',
			},
			option: {
				type: 'string',
				isMultiple: true,
			},
			description: {
				type: 'string',
			},
			// Setup flags
			noWeb: {
				type: 'boolean',
				default: false,
			},
			project: {
				type: 'string',
			},
			branch: {
				type: 'string',
			},
			target: {
				type: 'string',
			},
			skipProject: {
				type: 'boolean',
				default: false,
			},
			force: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

const parsedCliArgs = {
	input: cli.input,
	flags: cli.flags as CliFlags,
};
const formatter = new OutputFormatter(parsedCliArgs.flags.json);

// Validate devcontainer arguments using XOR
if (
	!!parsedCliArgs.flags.devcUpCommand !== !!parsedCliArgs.flags.devcExecCommand
) {
	formatter.writeError({
		text: [
			'Error: Both --devc-up-command and --devc-exec-command must be provided together',
		],
		data: {
			ok: false,
			error: {
				message:
					'Both --devc-up-command and --devc-exec-command must be provided together',
			},
		},
	});
	process.exit(1);
}

// Handle CLI subcommands
const rawSubcommand = parsedCliArgs.input[0];
const subcommand =
	parsedCliArgs.flags.headless && rawSubcommand === undefined
		? 'daemon'
		: (rawSubcommand ?? 'start');
const isDaemonMode = subcommand === 'daemon';
const isTuiOnlyMode = subcommand === 'tui';

// Handle setup subcommand BEFORE importing services (which auto-create config)
if (subcommand === 'setup') {
	const setupResult = await runSetupCommand(
		{
			port: parsedCliArgs.flags.port,
			noWeb: parsedCliArgs.flags.noWeb,
			skipProject: parsedCliArgs.flags.skipProject,
			project: parsedCliArgs.flags.project,
			force: parsedCliArgs.flags.force,
		},
		formatter,
	);

	if (setupResult.skipped) {
		if (!process.stdin.isTTY) {
			process.exit(1);
		}
	} else {
		process.exit(0);
	}
}

// First-run detection: for daemon start mode, run setup automatically
// This runs BEFORE importing services that auto-create config
if (isFirstRun && subcommand === 'start') {
	console.log('No configuration found. Running setup...');
	const {runSetup} = await import('./services/setupService.js');
	await runSetup({});
	console.log('');
	// Continue to start the app after setup
}

// Now import services that need config (after setup has run if needed)
const {projectManager} = await import('./services/projectManager.js');
const {worktreeConfigManager} = await import(
	'./services/worktreeConfigManager.js'
);
const {configurationManager} = await import(
	'./services/configurationManager.js'
);
const {globalSessionOrchestrator} = await import(
	'./services/globalSessionOrchestrator.js'
);
const {apiServer} = await import('./services/apiServer.js');
const {fileWatcherService} = await import('./services/fileWatcherService.js');
const {ENV_VARS, generateRandomPort} = await import('./constants/env.js');

const knownCommands = new Set([
	...getRegisteredCommands(),
	'setup',
	'daemon',
	'tui',
]);

if (subcommand && !knownCommands.has(subcommand)) {
	formatter.writeError({
		text: [
			`Unknown command: ${subcommand}`,
			'',
			'Available commands:',
			'  argusdev start         Start daemon in background',
			'  argusdev stop          Stop daemon',
			'  argusdev status        Show daemon status',
			'  argusdev sessions      Query active sessions (legacy)',
			'  argusdev session       Manage sessions (create/list/status/stop)',
			'  argusdev agents        Query configured agents',
			'  argusdev ui            Trigger UI workflow hooks (focus/send/approve/notify)',
			'  argusdev trigger       Alias for `argusdev ui`',
			'  argusdev focus         Alias for `argusdev ui focus`',
			'  argusdev send          Alias for `argusdev ui send` (stub)',
			'  argusdev approve       Alias for `argusdev ui approve` (stub)',
			'  argusdev notify        Alias for `argusdev ui notify` (stub)',
			'  argusdev restart       Restart daemon',
			'  argusdev setup         Run first-time setup',
			'  argusdev add [path]    Add a project',
			'  argusdev remove <path> Remove a project',
			'  argusdev list          List projects',
			'  argusdev project ...   Project subcommands',
			'  argusdev auth <cmd>    Manage WebUI auth',
			'  argusdev worktree <cmd> Manage worktrees via daemon API',
			'  argusdev tui           Launch TUI (daemon required)',
			'  argusdev daemon        Run API server in foreground',
			'  argusdev              Start daemon in background',
		],
		data: {
			ok: false,
			command: subcommand,
			error: {
				message: `Unknown command: ${subcommand}`,
				availableCommands: [
					'start',
					'stop',
					'status',
					'sessions',
					'session',
					'agents',
					'ui',
					'trigger',
					'focus',
					'send',
					'approve',
					'notify',
					'restart',
					'setup',
					'add',
					'remove',
					'list',
					'project',
					'auth',
					'worktree',
					'tui',
					'daemon',
				],
			},
		},
	});
	process.exit(1);
}

// Resolve port with precedence: CLI flag > env var > config > generate random
function resolvePort(): {port: number; isConfigured: boolean} {
	if (parsedCliArgs.flags.port !== undefined) {
		return {port: parsedCliArgs.flags.port, isConfigured: true};
	}

	const envPort = process.env[ENV_VARS.PORT];
	if (envPort) {
		const parsed = parseInt(envPort, 10);
		if (!isNaN(parsed)) {
			return {port: parsed, isConfigured: true};
		}
	}

	const configPort = configurationManager.getPort();
	if (configPort !== undefined) {
		return {port: configPort, isConfigured: true};
	}

	const randomPort = generateRandomPort();
	return {port: randomPort, isConfigured: false};
}

const {port, isConfigured: isPortConfigured} = resolvePort();

// Validate port
if (isNaN(port) || port < 1 || port > 65535) {
	formatter.writeError({
		text: [
			`Error: Invalid port number: ${port}`,
			'Port must be between 1 and 65535',
		],
		data: {
			ok: false,
			error: {
				message: `Invalid port number: ${port}`,
			},
		},
	});
	process.exit(1);
}

// Get the preferred outbound IP address by creating a UDP socket
function getExternalIP(): Promise<string | undefined> {
	return new Promise(resolve => {
		const socket = dgram.createSocket('udp4');
		socket.connect(80, '8.8.8.8', () => {
			const addr = socket.address();
			socket.close();
			resolve(typeof addr === 'string' ? undefined : addr.address);
		});
		socket.on('error', () => {
			socket.close();
			resolve(undefined);
		});
	});
}

// Get local hostname if it resolves to the same IP as our external IP
function getLocalHostname(
	externalIP: string | undefined,
): Promise<string | undefined> {
	if (!externalIP) return Promise.resolve(undefined);

	return new Promise(resolve => {
		const hostname = os.hostname();
		dns.lookup(hostname, {family: 4}, (err, addr) => {
			if (!err && addr === externalIP) {
				resolve(hostname);
			} else {
				resolve(undefined);
			}
		});
	});
}

async function withNetworkLinks(
	baseConfig: DaemonWebConfig,
	token: string | undefined,
): Promise<DaemonWebConfig> {
	const externalIP = await getExternalIP();
	const hostname = await getLocalHostname(externalIP);
	const tokenPath = token ? `/${token}` : '';

	return {
		...baseConfig,
		externalUrl: externalIP
			? `http://${externalIP}:${baseConfig.port}${tokenPath}`
			: undefined,
		hostname: hostname
			? `http://${hostname}:${baseConfig.port}${tokenPath}`
			: undefined,
	};
}

// Get config dir info for display (configDir already defined at top of file)
const customConfigDir = isCustomConfigDir();
const devModeActive = isDevModeConfig();
const accessToken = configurationManager.getConfiguration().accessToken;
const daemonPidFilePath = getDaemonPidFilePath(configDir);
const daemonLogPath = join(configDir, 'daemon.log');

const services: CliRuntimeServices = {
	projectManager,
	configurationManager,
	worktreeConfigManager,
	globalSessionOrchestrator,
	apiServer,
};

const commandContext: CliCommandContext = {
	subcommand,
	parsedArgs: parsedCliArgs,
	formatter,
	port,
	isPortConfigured,
	configDir,
	customConfigDir,
	devModeActive,
	accessToken,
	daemonPidFilePath,
	daemonLogPath,
	entrypointPath: process.argv[1],
	services,
	daemon: {
		lifecycle: {
			prepareDaemonPidFile,
			cleanupDaemonPidFile,
			readDaemonPidFile,
			isProcessRunning,
		},
		control: {
			buildDaemonWebConfig,
			ensureDaemonForTui,
			spawnDetachedDaemon,
			waitForDaemonPid,
			waitForDaemonApiReady,
		},
	},
};

const commandResult = await runRegisteredCommand(commandContext);
if (commandResult !== undefined) {
	process.exit(commandResult);
}

// If no daemon mode, continue to TUI - check TTY
if (!isDaemonMode && (!process.stdin.isTTY || !process.stdout.isTTY)) {
	formatter.writeError({
		text: [
			'Error: argusdev must be run in an interactive terminal (TTY)',
			'Use `argusdev start` to run daemon in background',
		],
		data: {
			ok: false,
			error: {
				message: 'argusdev must be run in an interactive terminal (TTY)',
			},
		},
	});
	process.exit(1);
}

// Initialize worktree config manager
worktreeConfigManager.initialize();

let webConfig: DaemonWebConfig | undefined;

if (isDaemonMode) {
	try {
		const result = await apiServer.start(
			port,
			'0.0.0.0',
			devModeActive,
			!isPortConfigured,
		);
		const actualPort = result.port;

		webConfig = await withNetworkLinks(
			{
				url:
					result.address.replace('0.0.0.0', 'localhost') +
					(accessToken ? `/${accessToken}` : ''),
				port: actualPort,
				configDir,
				isCustomConfigDir: customConfigDir,
				isDevMode: devModeActive,
			},
			accessToken,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		formatter.writeError({
			text: [`Failed to start daemon API server: ${message}`],
			data: {
				ok: false,
				command: 'daemon',
				error: {
					message,
				},
			},
		});
		process.exit(1);
	}
} else {
	try {
		const daemonConnection = await ensureDaemonForTui({
			configDir,
			port,
			accessToken,
			isCustomConfigDir: customConfigDir,
			isDevMode: devModeActive,
			autoStart: !isTuiOnlyMode,
		});
		webConfig = await withNetworkLinks(daemonConnection.webConfig, accessToken);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const prefix = isTuiOnlyMode
			? 'Failed to connect TUI to daemon'
			: 'Failed to start or connect to daemon';
		formatter.writeError({
			text: [`${prefix}: ${message}`],
			data: {
				ok: false,
				command: subcommand,
				error: {
					message: `${prefix}: ${message}`,
				},
			},
		});
		process.exit(1);
	}
}

// Prepare devcontainer config
const devcontainerConfig =
	parsedCliArgs.flags.devcUpCommand && parsedCliArgs.flags.devcExecCommand
		? {
				upCommand: parsedCliArgs.flags.devcUpCommand,
				execCommand: parsedCliArgs.flags.devcExecCommand,
			}
		: undefined;

// Pass config to App
const appProps = {
	...(devcontainerConfig ? {devcontainerConfig} : {}),
	webConfig,
};

// In daemon mode, run API server only without TUI
if (isDaemonMode) {
	const daemonPid = process.pid;

	try {
		await prepareDaemonPidFile(daemonPidFilePath, daemonPid);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		formatter.writeError({
			text: [`Failed to initialize daemon PID file: ${message}`],
			data: {
				ok: false,
				command: 'daemon',
				error: {
					message,
				},
			},
		});
		process.exit(1);
	}

	formatter.write({
		text: [
			'ArgusDev daemon started',
			`Local URL:    ${webConfig?.url || `http://localhost:${port}`}`,
			`Token:        ${accessToken || '(none configured)'}`,
			`External URL: ${webConfig?.externalUrl || '(unavailable)'}`,
			`PID:          ${daemonPid}`,
			`Config Dir:   ${configDir}`,
			`PID File:     ${daemonPidFilePath}`,
			'',
			'Use SIGTERM or Ctrl+C to stop',
		],
		data: {
			ok: true,
			command: 'daemon',
			pid: daemonPid,
			webConfig,
			accessToken,
			configDir,
			pidFile: daemonPidFilePath,
		},
	});

	let isShuttingDown = false;
	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (isShuttingDown) {
			return;
		}
		isShuttingDown = true;
		console.log(`\nReceived ${signal}, shutting down...`);

		// Stop file watchers
		try {
			fileWatcherService.stopAll();
		} catch (_error) {
			// ignore watcher cleanup errors
		}

		try {
			// Stop API server and cleanup resources (TD watcher, sockets, etc.)
			await apiServer.stop();
		} catch (_error) {
			// ignore stop errors during shutdown
		}

		try {
			// Intentionally avoid force-destroying sessions here.
			// Startup rehydration recovers active sessions after daemon restarts.
			await cleanupDaemonPidFile(daemonPidFilePath, daemonPid);
		} catch (_error) {
			// ignore cleanup errors during shutdown
		}
		process.exit(0);
	};

	process.on('SIGINT', () => {
		void shutdown('SIGINT');
	});

	process.on('SIGTERM', () => {
		void shutdown('SIGTERM');
	});
} else {
	if (!webConfig) {
		formatter.writeError({
			text: ['Failed to configure TUI daemon connection'],
			data: {
				ok: false,
				error: {
					message: 'Failed to configure TUI daemon connection',
				},
			},
		});
		process.exit(1);
	}

	// Normal TUI mode - import ink and React only when needed
	const {default: React} = await import('react');
	const {render} = await import('ink');
	const {default: App} = await import('./components/App.js');

	const app = render(React.createElement(App, appProps));

	// Clean up sessions on exit
	process.on('SIGINT', () => {
		globalSessionOrchestrator.destroyAllSessions();
		app.unmount();
		process.exit(0);
	});

	process.on('SIGTERM', () => {
		globalSessionOrchestrator.destroyAllSessions();
		app.unmount();
		process.exit(0);
	});
}

// Export for testing
export const parsedArgs = cli;
