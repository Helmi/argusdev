import {spawn, IPty} from 'node-pty';
import {
	Session,
	SessionManager as ISessionManager,
	SessionState,
	DevcontainerConfig,
	StateDetectionStrategy,
} from '../types/index.js';
import {EventEmitter} from 'events';
import pkg from '@xterm/headless';
import {exec, execFile} from 'child_process';
import {promisify} from 'util';
import {writeFile} from 'fs/promises';
import {join, basename} from 'path';
import {configurationManager} from './configurationManager.js';
import {executeStatusHook} from '../utils/hookExecutor.js';
import {
	STATE_PERSISTENCE_DURATION_MS,
	STATE_CHECK_INTERVAL_MS,
} from '../constants/statePersistence.js';
import {Effect} from 'effect';
import {ProcessError, ConfigError} from '../types/errors.js';
import {autoApprovalVerifier} from './autoApprovalVerifier.js';
import {logger} from '../utils/logger.js';
import {Mutex, createInitialSessionStateData} from '../utils/mutex.js';
import {getDefaultShell, getPtyEnv} from '../utils/platform.js';
import {adapterRegistry} from '../adapters/index.js';
import {ensureStartupScriptInGitExclude} from '../utils/startupScript.js';
import {cleanupHookSettingsFile} from '../utils/hookSettings.js';
const {Terminal} = pkg;
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const TERMINAL_CONTENT_MAX_LINES = 300;

export interface SessionCounts {
	idle: number;
	busy: number;
	waiting_input: number;
	pending_auto_approval: number;
	total: number;
}

interface AgentBootstrapOptions {
	initialPrompt?: string;
	promptArg?: string;
	prependCwd?: boolean;
	sessionIdOverride?: string;
	hookBasedDetection?: boolean;
	partialHookDetection?: boolean;
	hookCleanup?: () => void;
}

export class SessionManager extends EventEmitter implements ISessionManager {
	sessions: Map<string, Session>;
	private waitingWithBottomBorder: Map<string, boolean> = new Map();
	private busyTimers: Map<string, NodeJS.Timeout> = new Map();
	private promptLauncherDisabledKeys: Set<string> = new Set();

	// Track all active state check intervals for cleanup (especially hot reload)
	private activeIntervals: Map<string, NodeJS.Timeout> = new Map();

	// Dev mode detection
	private readonly isDevMode = process.env['ARGUSDEV_DEV'] === '1';

	public destroy(): void {
		// Clean up all sessions first
		for (const worktreePath of this.sessions.keys()) {
			this.destroySession(worktreePath);
		}

		// Clear all state check intervals
		for (const [sessionId, interval] of this.activeIntervals) {
			clearInterval(interval);
			if (this.isDevMode) {
				logger.info(
					`[SessionManager] Cleared interval for session ${sessionId}`,
				);
			}
		}
		this.activeIntervals.clear();

		// Clear busy timers
		for (const timer of this.busyTimers.values()) {
			clearTimeout(timer);
		}
		this.busyTimers.clear();

		// Remove all event listeners
		this.removeAllListeners();

		if (this.isDevMode) {
			logger.info('[SessionManager] Destroyed SessionManager');
		}
	}

	private async spawn(
		command: string,
		args: string[],
		worktreePath: string,
		extraEnv?: Record<string, string>,
	): Promise<IPty> {
		const spawnOptions = {
			name: 'xterm-256color',
			cols: process.stdout.columns || 80,
			rows: process.stdout.rows || 24,
			cwd: worktreePath,
			// Use platform-aware env: Unix gets TERM/COLORTERM, Windows preserved as-is
			env: getPtyEnv(extraEnv),
		};

		logger.info(
			`[SessionManager] Spawning: ${command} ${args.join(' ')} in ${worktreePath}`,
		);
		if (extraEnv && Object.keys(extraEnv).length > 0) {
			logger.info(
				`[SessionManager] Extra env: ${Object.keys(extraEnv).join(', ')}`,
			);
		}
		const pty = spawn(command, args, spawnOptions);
		logger.info(`[SessionManager] Spawned PID: ${pty.pid}`);
		return pty;
	}

	private isPowerShell(shellCommand: string): boolean {
		const normalized = shellCommand.toLowerCase();
		return (
			normalized.includes('powershell') ||
			normalized.endsWith('pwsh') ||
			normalized.endsWith('pwsh.exe')
		);
	}

	private formatPosixToken(value: string): string {
		if (value !== '' && /^[A-Za-z0-9_@%+=:,./~-]+$/.test(value)) {
			return value;
		}

		return `'${value.replace(/'/g, `'"'"'`)}'`;
	}

	private formatPowerShellToken(value: string): string {
		if (value !== '' && /^[A-Za-z0-9_@%+=:,./\\~-]+$/.test(value)) {
			return value;
		}

		return `'${value.replace(/'/g, "''")}'`;
	}

	private normalizePromptArg(promptArg?: string): string | undefined {
		const normalized = promptArg?.trim();
		if (!normalized) return undefined;
		return normalized;
	}

	private applyInitialPromptToArgs(
		args: string[],
		initialPrompt?: string,
		promptArg?: string,
	): string[] {
		const normalizedPromptArg = this.normalizePromptArg(promptArg);
		if (!initialPrompt || normalizedPromptArg?.toLowerCase() === 'none') {
			return [...args];
		}
		if (normalizedPromptArg) {
			return [...args, normalizedPromptArg, initialPrompt];
		}
		return [...args, initialPrompt];
	}

	private parseCommandAndInlineArgs(
		command: string,
		args: string[],
	): {command: string; args: string[]} {
		const trimmed = command.trim();
		if (!trimmed.includes(' ')) {
			return {command: trimmed, args: [...args]};
		}

		const parts = trimmed.split(/\s+/).filter(Boolean);
		const [resolvedCommand, ...inlineArgs] = parts;
		if (!resolvedCommand) {
			return {command: trimmed, args: [...args]};
		}

		return {
			command: resolvedCommand,
			args: [...inlineArgs, ...args],
		};
	}

	private async ensureAgentCommandAvailable(command: string): Promise<void> {
		const trimmedCommand = command.trim();
		if (!trimmedCommand) {
			throw new Error(
				'Agent command is empty. Configure a valid command before starting a session.',
			);
		}

		// Path-based commands are resolved by the shell/runtime directly.
		if (trimmedCommand.includes('/') || trimmedCommand.includes('\\')) {
			return;
		}

		const lookupCommand = process.platform === 'win32' ? 'where' : 'which';

		try {
			await execFileAsync(lookupCommand, [trimmedCommand]);
		} catch {
			throw new Error(
				`Agent command "${trimmedCommand}" not found in PATH. Install it or update the configured agent command.`,
			);
		}
	}

	private shouldUsePromptLauncher(
		shellCommand: string,
		initialPrompt?: string,
		promptArg?: string,
	): boolean {
		const normalizedPromptArg = this.normalizePromptArg(promptArg);
		if (!initialPrompt || normalizedPromptArg?.toLowerCase() === 'none') {
			return false;
		}
		if (this.isPowerShell(shellCommand)) {
			return false;
		}
		return /[\n\r`"'\\$]/.test(initialPrompt);
	}

	private async writePromptLauncherScript(
		worktreePath: string,
		command: string,
		args: string[],
		initialPrompt: string,
		promptArg?: string,
		prependCwd?: boolean,
	): Promise<string> {
		const normalizedPromptArg = this.normalizePromptArg(promptArg);
		const scriptId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const scriptPath = join(worktreePath, `.argusdev-startup-${scriptId}.sh`);
		const delimiter = `ARGUSDEV_PROMPT_${scriptId.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}_EOF`;

		const commandTokens = [
			this.formatPosixToken(command),
			...(prependCwd ? [this.formatPosixToken('.')] : []),
			...args.map(arg => this.formatPosixToken(arg)),
		];
		if (normalizedPromptArg && normalizedPromptArg.toLowerCase() !== 'none') {
			commandTokens.push(this.formatPosixToken(normalizedPromptArg));
		}
		commandTokens.push('"$ARGUSDEV_PROMPT"');

		const scriptContent = `#!/usr/bin/env bash
SCRIPT_PATH="$0"
cleanup() { rm -f "$SCRIPT_PATH"; }
trap cleanup EXIT
ARGUSDEV_PROMPT=$(cat <<'${delimiter}'
${initialPrompt}
${delimiter}
)
${commandTokens.join(' ')}
`;

		await writeFile(scriptPath, scriptContent, {
			encoding: 'utf-8',
			mode: 0o700,
		});

		const scriptFileName = basename(scriptPath);
		const isExcluded = await ensureStartupScriptInGitExclude(
			worktreePath,
			scriptFileName,
		);
		if (!isExcluded) {
			logger.warn(
				`[SessionManager] Could not add startup launcher script to git exclude file for ${scriptFileName}`,
			);
		}

		return scriptPath;
	}

	private buildBootstrapCommand(
		shellCommand: string,
		command: string,
		args: string[],
		initialPrompt?: string,
		promptArg?: string,
	): string {
		const resolvedArgs = this.applyInitialPromptToArgs(
			args,
			initialPrompt,
			promptArg,
		);

		if (this.isPowerShell(shellCommand)) {
			const formattedCommand = this.formatPowerShellToken(command);
			const formattedArgs = resolvedArgs.map(arg =>
				this.formatPowerShellToken(arg),
			);
			return ['&', formattedCommand, ...formattedArgs].join(' ');
		}

		const formattedCommand = this.formatPosixToken(command);
		const formattedArgs = resolvedArgs.map(arg => this.formatPosixToken(arg));
		return [formattedCommand, ...formattedArgs].join(' ');
	}

	private bootstrapCommandInShell(
		shellProcess: IPty,
		shellCommand: string,
		command: string,
		args: string[],
		initialPrompt?: string,
		promptArg?: string,
	): void {
		const bootstrapCommand = this.buildBootstrapCommand(
			shellCommand,
			command,
			args,
			initialPrompt,
			promptArg,
		);
		logger.info(
			`[SessionManager] Bootstrapping shell with: ${command} (${args.length} args${initialPrompt ? ' + startup prompt' : ''})`,
		);
		shellProcess.write(`${bootstrapCommand}\r`);
	}

	detectTerminalState(session: Session): SessionState {
		// Create a detector based on the session's detection strategy
		const strategy = session.detectionStrategy || 'claude';
		const stateData = session.stateMutex.getSnapshot();
		const adapter = adapterRegistry.getByStrategy(strategy);
		const detectedState = adapter
			? adapter.detectState(session.terminal, stateData.state)
			: stateData.state;

		// If auto-approval is enabled and state is waiting_input, convert to pending_auto_approval
		if (
			detectedState === 'waiting_input' &&
			configurationManager.isAutoApprovalEnabled() &&
			!stateData.autoApprovalFailed
		) {
			return 'pending_auto_approval';
		}

		return detectedState;
	}

	/**
	 * Apply a state change from a Claude Code HTTP hook event.
	 * Bypasses the pending/persistence delay — hook events are authoritative.
	 */
	applyHookStateEvent(sessionId: string, newState: SessionState): void {
		const session = this.sessions.get(sessionId);
		if (
			!session ||
			(!session.hookBasedDetection && !session.partialHookDetection)
		)
			return;

		// Auto-approval integration: convert waiting_input to pending_auto_approval
		let resolvedState = newState;
		if (
			resolvedState === 'waiting_input' &&
			configurationManager.isAutoApprovalEnabled()
		) {
			const stateData = session.stateMutex.getSnapshot();
			if (!stateData.autoApprovalFailed) {
				resolvedState = 'pending_auto_approval';
			}
		}

		void this.updateSessionState(session, resolvedState);
	}

	private getTerminalContent(session: Session): string {
		const buffer = session.terminal.buffer.active;
		const lines: string[] = [];

		// Start from the bottom and work our way up
		for (
			let i = buffer.length - 1;
			i >= 0 && lines.length < TERMINAL_CONTENT_MAX_LINES;
			i--
		) {
			const line = buffer.getLine(i);
			if (line) {
				const text = line.translateToString(true);
				// Skip empty lines at the bottom
				if (lines.length > 0 || text.trim() !== '') {
					lines.unshift(text);
				}
			}
		}

		return lines.join('\n');
	}

	private handleAutoApproval(session: Session): void {
		// Cancel any existing verification before starting a new one
		this.cancelAutoApprovalVerification(
			session,
			'Restarting verification for pending auto-approval state',
		);

		const abortController = new AbortController();
		void session.stateMutex.update(data => ({
			...data,
			autoApprovalAbortController: abortController,
			autoApprovalReason: undefined,
		}));

		// Get terminal content for verification
		const terminalContent = this.getTerminalContent(session);

		// Verify if permission is needed
		void Effect.runPromise(
			autoApprovalVerifier.verifyNeedsPermission(terminalContent, {
				signal: abortController.signal,
			}),
		)
			.then(async autoApprovalResult => {
				if (abortController.signal.aborted) {
					logger.debug(
						`[${session.id}] Auto-approval verification aborted before completion`,
					);
					return;
				}

				// If state already moved away, skip handling
				const currentState = session.stateMutex.getSnapshot().state;
				if (currentState !== 'pending_auto_approval') {
					logger.debug(
						`[${session.id}] Skipping auto-approval handling; current state is ${currentState}`,
					);
					return;
				}

				if (autoApprovalResult.needsPermission) {
					// Change state to waiting_input to ask for user permission
					logger.info(
						`[${session.id}] Auto-approval verification determined user permission needed`,
					);
					await this.updateSessionState(session, 'waiting_input', {
						autoApprovalFailed: true,
						autoApprovalReason: autoApprovalResult.reason,
					});
				} else {
					// Auto-approve by simulating Enter key press
					logger.info(
						`[${session.id}] Auto-approval granted, simulating user permission`,
					);
					session.process.write('\r');
					// Force state to busy to prevent endless auto-approval
					// when the state detection still sees pending_auto_approval
					await this.updateSessionState(session, 'busy', {
						autoApprovalReason: undefined,
					});
				}
			})
			.catch(async (error: unknown) => {
				if (abortController.signal.aborted) {
					logger.debug(
						`[${session.id}] Auto-approval verification aborted (${(error as Error)?.message ?? 'aborted'})`,
					);
					return;
				}

				// On failure, fall back to requiring explicit permission
				logger.error(
					`[${session.id}] Auto-approval verification failed, requiring user permission`,
					error,
				);

				const currentState = session.stateMutex.getSnapshot().state;
				if (currentState === 'pending_auto_approval') {
					await this.updateSessionState(session, 'waiting_input', {
						autoApprovalFailed: true,
						autoApprovalReason:
							(error as Error | undefined)?.message ??
							'Auto-approval verification failed',
					});
				}
			})
			.finally(async () => {
				const currentController =
					session.stateMutex.getSnapshot().autoApprovalAbortController;
				if (currentController === abortController) {
					await session.stateMutex.update(data => ({
						...data,
						autoApprovalAbortController: undefined,
					}));
				}
			});
	}

	private cancelAutoApprovalVerification(
		session: Session,
		reason: string,
	): void {
		const stateData = session.stateMutex.getSnapshot();
		const controller = stateData.autoApprovalAbortController;
		if (!controller) {
			return;
		}

		if (!controller.signal.aborted) {
			controller.abort();
		}

		void session.stateMutex.update(data => ({
			...data,
			autoApprovalAbortController: undefined,
		}));
		logger.info(
			`[${session.id}] Cancelled auto-approval verification: ${reason}`,
		);
	}

	/**
	 * Update session state with automatic status hook execution.
	 * This method ensures that executeStatusHook is always called when state changes.
	 *
	 * @param session - The session to update
	 * @param newState - The new state to set
	 * @param additionalUpdates - Optional additional state data updates
	 */
	private async updateSessionState(
		session: Session,
		newState: SessionState,
		additionalUpdates: Partial<
			Omit<import('../utils/mutex.js').SessionStateData, 'state'>
		> = {},
	): Promise<void> {
		const oldState = session.stateMutex.getSnapshot().state;

		await session.stateMutex.update(data => ({
			...data,
			state: newState,
			pendingState: undefined,
			pendingStateStart: undefined,
			...additionalUpdates,
		}));

		if (oldState !== newState) {
			void Effect.runPromise(executeStatusHook(oldState, newState, session));
			this.emit('sessionStateChanged', session);
		}
	}

	constructor() {
		super();
		this.sessions = new Map();
	}

	createSessionId(): string {
		return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private createTerminal(): pkg.Terminal {
		return new Terminal({
			cols: process.stdout.columns || 80,
			rows: process.stdout.rows || 24,
			allowProposedApi: true,
			logLevel: 'off',
		});
	}

	private async createSessionInternal(
		worktreePath: string,
		ptyProcess: IPty,
		commandConfig:
			| {
					command: string;
					args?: string[];
					fallbackArgs?: string[];
			  }
			| undefined,
		options: {
			isPrimaryCommand?: boolean;
			detectionStrategy?: StateDetectionStrategy;
			hookBasedDetection?: boolean;
			partialHookDetection?: boolean;
			hookCleanup?: () => void;
			devcontainerConfig?: DevcontainerConfig;
			sessionName?: string;
			agentId?: string;
			sessionId?: string;
		} = {},
	): Promise<Session> {
		const resolvedSessionId = options.sessionId?.trim();
		const id = resolvedSessionId || this.createSessionId();
		if (this.sessions.has(id)) {
			throw new Error(`Session with ID ${id} already exists`);
		}
		const terminal = this.createTerminal();

		const session: Session = {
			id,
			name: options.sessionName,
			worktreePath,
			agentId: options.agentId,
			process: ptyProcess,
			output: [],
			outputHistory: [],
			lastActivity: new Date(),
			isActive: false,
			terminal,
			stateCheckInterval: undefined, // Will be set in setupBackgroundHandler
			isPrimaryCommand: options.isPrimaryCommand ?? true,
			commandConfig,
			detectionStrategy: options.detectionStrategy ?? 'claude',
			hookBasedDetection: options.hookBasedDetection ?? false,
			partialHookDetection: options.partialHookDetection ?? false,
			hookCleanup: options.hookCleanup,
			devcontainerConfig: options.devcontainerConfig ?? undefined,
			stateMutex: new Mutex({
				...createInitialSessionStateData(),
				// Hook-based sessions start idle — hooks will signal busy
				state:
					options.hookBasedDetection || options.partialHookDetection
						? 'idle'
						: 'busy',
			}),
		};

		// Set up persistent background data handler for state detection
		this.setupBackgroundHandler(session);

		// Key by session ID instead of worktreePath to allow multiple sessions per worktree
		this.sessions.set(session.id, session);

		// Record the timestamp when this worktree was opened
		configurationManager.setWorktreeLastOpened(worktreePath, Date.now());

		logger.info(
			`[SessionManager] Session created: ${session.id} worktree=${worktreePath} agent=${options.agentId ?? 'none'}`,
		);

		this.emit('sessionCreated', session);

		return session;
	}

	/**
	 * Create session with command preset using Effect-based error handling
	 *
	 * @param {string} worktreePath - Path to the worktree
	 * @param {string} [presetId] - Optional preset ID, uses default if not provided
	 * @returns {Effect.Effect<Session, ProcessError | ConfigError, never>} Effect that may fail with ProcessError (spawn failure) or ConfigError (invalid preset)
	 *
	 * @example
	 * ```typescript
	 * // Use Effect.match for type-safe error handling
	 * const result = await Effect.runPromise(
	 *   Effect.match(effect, {
	 *     onFailure: (error) => ({ type: 'error', message: error.message }),
	 *     onSuccess: (session) => ({ type: 'success', data: session })
	 *   })
	 * );
	 * ```
	 */
	createSessionWithPresetEffect(
		worktreePath: string,
		presetId?: string,
		sessionName?: string,
	): Effect.Effect<Session, ProcessError | ConfigError, never> {
		return Effect.tryPromise({
			try: async () => {
				// Get preset configuration
				let preset = presetId
					? configurationManager.getPresetById(presetId)
					: null;
				if (!preset) {
					preset = configurationManager.getDefaultPreset();
				}

				// Validate preset exists
				if (!preset) {
					throw new ConfigError({
						configPath: 'configuration',
						reason: 'validation',
						details: presetId
							? `Preset with ID '${presetId}' not found and no default preset available`
							: 'No default preset available',
					});
				}

				const command = preset.command;
				const args = preset.args || [];
				const commandConfig = {
					command: preset.command,
					args: preset.args,
					fallbackArgs: preset.fallbackArgs,
				};

				// Spawn the process - fallback will be handled by setupExitHandler
				const ptyProcess = await this.spawn(command, args, worktreePath);

				return this.createSessionInternal(
					worktreePath,
					ptyProcess,
					commandConfig,
					{
						isPrimaryCommand: true,
						detectionStrategy: preset.detectionStrategy,
						sessionName,
						agentId: preset.id,
					},
				);
			},
			catch: (error: unknown) => {
				// If it's already a ConfigError, return it
				if (error instanceof ConfigError) {
					return error;
				}

				// Otherwise, wrap in ProcessError
				return new ProcessError({
					command: presetId
						? `createSessionWithPreset (preset: ${presetId})`
						: 'createSessionWithPreset (default preset)',
					message:
						error instanceof Error
							? error.message
							: 'Failed to create session with preset',
				});
			},
		});
	}

	/**
	 * Create a session using a resolved agent command and args.
	 * This is the new method for the agent configuration system.
	 *
	 * @param worktreePath - Path to the worktree
	 * @param command - Resolved command (e.g., 'claude', '/bin/zsh')
	 * @param args - Resolved arguments array
	 * @param detectionStrategy - Optional state detection strategy
	 * @param sessionName - Optional custom session name
	 * @param agentId - Optional agent ID
	 * @param extraEnv - Optional extra environment variables to pass to the process
	 * @param agentKind - Agent kind (`agent` or `terminal`)
	 */
	createSessionWithAgentEffect(
		worktreePath: string,
		command: string,
		args: string[],
		detectionStrategy?: StateDetectionStrategy,
		sessionName?: string,
		agentId?: string,
		extraEnv?: Record<string, string>,
		agentKind: 'agent' | 'terminal' = 'agent',
		bootstrapOptions?: AgentBootstrapOptions,
	): Effect.Effect<Session, ProcessError, never> {
		return Effect.tryPromise({
			try: async () => {
				const resolvedCommand = this.parseCommandAndInlineArgs(command, args);
				const promptLauncherFailureKey = `${worktreePath}:${resolvedCommand.command}`;

				if (agentKind !== 'terminal') {
					await this.ensureAgentCommandAvailable(resolvedCommand.command);
				}

				// Spawn a persistent shell first; agent command runs inside it.
				const shellCommand = getDefaultShell();
				const shellProcess = await this.spawn(
					shellCommand,
					[],
					worktreePath,
					extraEnv,
				);

				// Create session without fallback config (agent sessions don't use fallback)
				const session = this.createSessionInternal(
					worktreePath,
					shellProcess,
					undefined, // No legacy commandConfig
					{
						isPrimaryCommand: true,
						detectionStrategy: detectionStrategy,
						hookBasedDetection: bootstrapOptions?.hookBasedDetection,
						partialHookDetection: bootstrapOptions?.partialHookDetection,
						hookCleanup: bootstrapOptions?.hookCleanup,
						sessionName: sessionName,
						agentId: agentId,
						sessionId: bootstrapOptions?.sessionIdOverride,
					},
				);

				// Terminal-kind sessions are plain interactive shells.
				// Agent-kind sessions execute one bootstrap command, then return to shell prompt on exit.
				if (agentKind !== 'terminal') {
					const commandArgs = resolvedCommand.args;
					const bootstrapArgs = bootstrapOptions?.prependCwd
						? ['.', ...commandArgs]
						: commandArgs;
					const shouldSkipPromptInjection =
						this.promptLauncherDisabledKeys.has(promptLauncherFailureKey) &&
						this.shouldUsePromptLauncher(
							shellCommand,
							bootstrapOptions?.initialPrompt,
							bootstrapOptions?.promptArg,
						);

					if (
						!shouldSkipPromptInjection &&
						this.shouldUsePromptLauncher(
							shellCommand,
							bootstrapOptions?.initialPrompt,
							bootstrapOptions?.promptArg,
						) &&
						bootstrapOptions?.initialPrompt
					) {
						try {
							const scriptPath = await this.writePromptLauncherScript(
								worktreePath,
								resolvedCommand.command,
								commandArgs,
								bootstrapOptions.initialPrompt,
								bootstrapOptions.promptArg,
								bootstrapOptions.prependCwd,
							);
							this.bootstrapCommandInShell(shellProcess, shellCommand, 'bash', [
								scriptPath,
							]);
						} catch (error) {
							this.promptLauncherDisabledKeys.add(promptLauncherFailureKey);
							logger.warn(
								`[SessionManager] Failed to create prompt launcher script, disabling startup prompt injection for ${resolvedCommand.command}: ${error}`,
							);
							this.bootstrapCommandInShell(
								shellProcess,
								shellCommand,
								resolvedCommand.command,
								bootstrapArgs,
							);
						}
					} else {
						this.bootstrapCommandInShell(
							shellProcess,
							shellCommand,
							resolvedCommand.command,
							bootstrapArgs,
							shouldSkipPromptInjection
								? undefined
								: bootstrapOptions?.initialPrompt,
							shouldSkipPromptInjection
								? undefined
								: bootstrapOptions?.promptArg,
						);
					}
				}

				return session;
			},
			catch: (error: unknown) => {
				return new ProcessError({
					command: `createSessionWithAgent (${command})`,
					message:
						error instanceof Error
							? error.message
							: 'Failed to create session with agent',
				});
			},
		});
	}

	private setupDataHandler(session: Session): void {
		// This handler always runs for all data
		session.process.onData((data: string) => {
			// Write data to virtual terminal
			session.terminal.write(data);

			// Store in output history as Buffer
			const buffer = Buffer.from(data, 'utf8');
			session.outputHistory.push(buffer);

			// Limit memory usage - keep max 1MB of output history.
			// xterm renders only ~1000 lines (~500KB-1MB once ANSI overhead is
			// included), so anything beyond this is parsed on replay and then
			// immediately scrolled off — wasted memory and a larger surface for
			// replay-time corruption (xterm auto-answering embedded queries).
			const MAX_HISTORY_SIZE = 1 * 1024 * 1024; // 1MB
			let totalSize = session.outputHistory.reduce(
				(sum, buf) => sum + buf.length,
				0,
			);
			while (totalSize > MAX_HISTORY_SIZE && session.outputHistory.length > 0) {
				const removed = session.outputHistory.shift();
				if (removed) {
					totalSize -= removed.length;
				}
			}

			session.lastActivity = new Date();

			// Only emit data events when session is active
			if (session.isActive) {
				this.emit('sessionData', session, data);
			}
		});
	}

	/**
	 * Sets up exit handler for the session process.
	 * When the process exits with code 1 and it's the primary command,
	 * it will attempt to spawn a fallback process.
	 * If fallbackArgs are configured, they will be used.
	 * If no fallbackArgs are configured, the command will be retried with no arguments.
	 */
	private setupExitHandler(session: Session): void {
		session.process.onExit(async (e: {exitCode: number; signal?: number}) => {
			logger.info(
				`[SessionManager] PTY exit: ${session.id} code=${e.exitCode} signal=${e.signal ?? 'none'}`,
			);
			// Check if we should attempt fallback
			// Only attempt fallback for preset sessions (commandConfig exists), not agent sessions
			if (
				e.exitCode === 1 &&
				!e.signal &&
				session.isPrimaryCommand &&
				session.commandConfig
			) {
				try {
					let fallbackProcess: IPty;
					// Use fallback args if available, otherwise use empty args
					const fallbackArgs = session.commandConfig?.fallbackArgs || [];

					// Check if we're in a devcontainer session
					if (session.devcontainerConfig) {
						// Parse the exec command to extract arguments
						const execParts =
							session.devcontainerConfig.execCommand.split(/\s+/);
						const devcontainerCmd = execParts[0] || 'devcontainer';
						const execArgs = execParts.slice(1);

						// Build fallback command for devcontainer
						const fallbackFullArgs = [
							...execArgs,
							'--',
							session.commandConfig?.command || 'claude',
							...fallbackArgs,
						];

						fallbackProcess = await this.spawn(
							devcontainerCmd,
							fallbackFullArgs,
							session.worktreePath,
						);
					} else {
						// Regular fallback without devcontainer
						fallbackProcess = await this.spawn(
							session.commandConfig?.command || 'claude',
							fallbackArgs,
							session.worktreePath,
						);
					}

					// Replace the process
					session.process = fallbackProcess;
					session.isPrimaryCommand = false;

					// Setup handlers for the new process (data and exit only)
					this.setupDataHandler(session);
					this.setupExitHandler(session);

					// Emit event to notify process replacement
					this.emit('sessionProcessReplaced', session);
				} catch (_error) {
					// Fallback failed, proceed with cleanup
					this.cleanupSession(session);
				}
			} else {
				// No fallback needed or possible, cleanup
				this.cleanupSession(session);
			}
		});
	}

	private setupBackgroundHandler(session: Session): void {
		// Setup data handler
		this.setupDataHandler(session);

		if (session.hookBasedDetection && !session.partialHookDetection) {
			// Full hook-based sessions receive state from HTTP events — no polling needed.
			logger.info(
				`[SessionManager] Session ${session.id} using hook-based state detection, skipping polling`,
			);
			this.setupExitHandler(session);
			return;
		}

		if (session.partialHookDetection) {
			logger.info(
				`[SessionManager] Session ${session.id} using partial hook-based detection (hooks for busy/idle, PTY polling for waiting_input)`,
			);
		}

		// Hot reload protection: Clear existing interval if any
		if (session.stateCheckInterval) {
			if (this.isDevMode) {
				logger.warn(
					`[SessionManager] Session ${session.id} already has state check interval - cleaning up previous`,
				);
			}
			clearInterval(session.stateCheckInterval);
			this.activeIntervals.delete(session.id);
		}

		// Set up interval-based state detection with persistence
		session.stateCheckInterval = setInterval(() => {
			const stateData = session.stateMutex.getSnapshot();
			const oldState = stateData.state;
			const detectedState = this.detectTerminalState(session);
			const now = Date.now();

			// If detected state is different from current state
			if (detectedState !== oldState) {
				// If this is a new pending state or the pending state changed
				if (stateData.pendingState !== detectedState) {
					void session.stateMutex.update(data => ({
						...data,
						pendingState: detectedState,
						pendingStateStart: now,
					}));
				} else if (
					stateData.pendingState !== undefined &&
					stateData.pendingStateStart !== undefined
				) {
					// Check if the pending state has persisted long enough
					const duration = now - stateData.pendingStateStart;
					if (duration >= STATE_PERSISTENCE_DURATION_MS) {
						// Cancel auto-approval verification if state is changing away from pending_auto_approval
						if (
							stateData.autoApprovalAbortController &&
							detectedState !== 'pending_auto_approval'
						) {
							this.cancelAutoApprovalVerification(
								session,
								`state changed to ${detectedState}`,
							);
						}

						// Build additional updates for auto-approval reset
						const additionalUpdates: Partial<
							Omit<import('../utils/mutex.js').SessionStateData, 'state'>
						> = {};

						// If we previously blocked auto-approval and have moved out of a user prompt,
						// allow future auto-approval attempts.
						if (
							stateData.autoApprovalFailed &&
							detectedState !== 'waiting_input' &&
							detectedState !== 'pending_auto_approval'
						) {
							additionalUpdates.autoApprovalFailed = false;
							additionalUpdates.autoApprovalReason = undefined;
						}

						// Confirm the state change with hook execution
						void this.updateSessionState(
							session,
							detectedState,
							additionalUpdates,
						);
					}
				}
			} else {
				// Detected state matches current state, clear any pending state
				void session.stateMutex.update(data => ({
					...data,
					pendingState: undefined,
					pendingStateStart: undefined,
				}));
			}

			// Handle auto-approval if state is pending_auto_approval and no verification is in progress.
			// This ensures auto-approval is retried when the state remains pending_auto_approval
			// but the previous verification completed (success, failure, timeout, or abort).
			const currentStateData = session.stateMutex.getSnapshot();
			if (
				currentStateData.state === 'pending_auto_approval' &&
				!currentStateData.autoApprovalAbortController
			) {
				this.handleAutoApproval(session);
			}
		}, STATE_CHECK_INTERVAL_MS);

		// Track interval for cleanup
		this.activeIntervals.set(session.id, session.stateCheckInterval);

		// Setup exit handler
		this.setupExitHandler(session);
	}

	private cleanupSession(session: Session): void {
		logger.info(
			`[SessionManager] Session cleanup: ${session.id} (process exit)`,
		);
		const stateData = session.stateMutex.getSnapshot();
		if (stateData.autoApprovalAbortController) {
			this.cancelAutoApprovalVerification(session, 'Session cleanup');
		}

		// Clear the state check interval and remove from tracking
		if (session.stateCheckInterval) {
			clearInterval(session.stateCheckInterval);
			this.activeIntervals.delete(session.id);
			session.stateCheckInterval = undefined;
		}

		// Clean up hook config files on session end
		if (session.hookCleanup) {
			session.hookCleanup();
		} else if (session.hookBasedDetection) {
			// Legacy path: Claude sessions without a stored cleanup fn
			cleanupHookSettingsFile(session.id);
		}

		// Clear any pending state and update state to idle before destroying
		void this.updateSessionState(session, 'idle');
		this.destroySession(session.id);
		this.emit('sessionExit', session);
	}

	// Get session by ID (primary lookup method)
	getSession(sessionId: string): Session | undefined {
		return this.sessions.get(sessionId);
	}

	// Get first session for a worktree path (backwards compatibility)
	getSessionByPath(worktreePath: string): Session | undefined {
		for (const session of this.sessions.values()) {
			if (session.worktreePath === worktreePath) {
				return session;
			}
		}
		return undefined;
	}

	// Get all sessions for a worktree path
	getSessionsForWorktree(worktreePath: string): Session[] {
		return Array.from(this.sessions.values()).filter(
			session => session.worktreePath === worktreePath,
		);
	}

	setSessionActive(sessionId: string, active: boolean): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.isActive = active;

			// If becoming active, record the timestamp when this worktree was opened
			if (active) {
				configurationManager.setWorktreeLastOpened(
					session.worktreePath,
					Date.now(),
				);

				// Emit a restore event with the output history if available
				if (session.outputHistory.length > 0) {
					this.emit('sessionRestore', session);
				}
			}
		}
	}

	renameSession(sessionId: string, name?: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return false;
		}

		const normalizedName = name?.trim();
		session.name = normalizedName ? normalizedName : undefined;
		this.emit('sessionUpdated', session);
		return true;
	}

	cancelAutoApproval(sessionId: string, reason = 'User input received'): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}

		const stateData = session.stateMutex.getSnapshot();
		if (
			stateData.state !== 'pending_auto_approval' &&
			!stateData.autoApprovalAbortController
		) {
			return;
		}

		this.cancelAutoApprovalVerification(session, reason);

		if (stateData.state === 'pending_auto_approval') {
			// State change: pending_auto_approval -> waiting_input
			void this.updateSessionState(session, 'waiting_input', {
				autoApprovalFailed: true,
				autoApprovalReason: reason,
			});
		} else {
			// No state change, just update other fields
			void session.stateMutex.update(data => ({
				...data,
				autoApprovalFailed: true,
				autoApprovalReason: reason,
				pendingState: undefined,
				pendingStateStart: undefined,
			}));
		}
	}

	destroySession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			logger.info(`[SessionManager] Session destroyed: ${sessionId}`);
			const stateData = session.stateMutex.getSnapshot();
			if (stateData.autoApprovalAbortController) {
				this.cancelAutoApprovalVerification(session, 'Session destroyed');
			}

			// Clear the state check interval
			if (session.stateCheckInterval) {
				clearInterval(session.stateCheckInterval);
			}
			try {
				session.process.kill('SIGKILL');
			} catch (_error) {
				// Process might already be dead
			}
			// Clean up any pending timer
			const timer = this.busyTimers.get(session.worktreePath);
			if (timer) {
				clearTimeout(timer);
				this.busyTimers.delete(session.worktreePath);
			}
			this.sessions.delete(sessionId);
			this.waitingWithBottomBorder.delete(sessionId);
			this.emit('sessionDestroyed', session);
		}
	}

	/**
	 * Terminate session and cleanup resources using Effect-based error handling
	 *
	 * @param {string} sessionId - Session ID to terminate
	 * @returns {Effect.Effect<void, ProcessError, never>} Effect that may fail with ProcessError if session does not exist or cleanup fails
	 *
	 * @example
	 * ```typescript
	 * // Terminate session with error handling
	 * const result = await Effect.runPromise(
	 *   Effect.match(effect, {
	 *     onFailure: (error) => ({ type: 'error', message: error.message }),
	 *     onSuccess: () => ({ type: 'success' })
	 *   })
	 * );
	 * ```
	 */
	terminateSessionEffect(
		sessionId: string,
	): Effect.Effect<void, ProcessError, never> {
		return Effect.try({
			try: () => {
				const session = this.sessions.get(sessionId);
				if (!session) {
					throw new ProcessError({
						command: 'terminateSession',
						message: `Session not found: ${sessionId}`,
					});
				}

				// Clear the state check interval
				if (session.stateCheckInterval) {
					clearInterval(session.stateCheckInterval);
				}

				// Try to kill the process - don't fail if process is already dead
				try {
					session.process.kill('SIGKILL');
				} catch (_error) {
					// Process might already be dead, this is acceptable
				}

				// Clean up any pending timer
				const timer = this.busyTimers.get(session.worktreePath);
				if (timer) {
					clearTimeout(timer);
					this.busyTimers.delete(session.worktreePath);
				}

				// Remove from sessions map and cleanup
				this.sessions.delete(sessionId);
				this.waitingWithBottomBorder.delete(sessionId);
				this.emit('sessionDestroyed', session);
			},
			catch: (error: unknown) => {
				// If it's already a ProcessError, return it
				if (error instanceof ProcessError) {
					return error;
				}

				// Otherwise, wrap in ProcessError
				return new ProcessError({
					command: 'terminateSession',
					message:
						error instanceof Error
							? error.message
							: `Failed to terminate session: ${sessionId}`,
				});
			},
		});
	}

	getAllSessions(): Session[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Create session with devcontainer integration using Effect-based error handling
	 * @returns Effect that may fail with ProcessError (container/spawn failure) or ConfigError (invalid preset)
	 */
	createSessionWithDevcontainerEffect(
		worktreePath: string,
		devcontainerConfig: DevcontainerConfig,
		presetId?: string,
		sessionName?: string,
	): Effect.Effect<Session, ProcessError | ConfigError, never> {
		return Effect.tryPromise({
			try: async () => {
				// Execute devcontainer up command first
				try {
					await execAsync(devcontainerConfig.upCommand, {cwd: worktreePath});
				} catch (error) {
					throw new ProcessError({
						command: devcontainerConfig.upCommand,
						message: `Failed to start devcontainer: ${error instanceof Error ? error.message : String(error)}`,
					});
				}

				// Get preset configuration
				let preset = presetId
					? configurationManager.getPresetById(presetId)
					: null;
				if (!preset) {
					preset = configurationManager.getDefaultPreset();
				}

				// Validate preset exists
				if (!preset) {
					throw new ConfigError({
						configPath: 'configuration',
						reason: 'validation',
						details: presetId
							? `Preset with ID '${presetId}' not found and no default preset available`
							: 'No default preset available',
					});
				}

				// Parse the exec command to extract arguments
				const execParts = devcontainerConfig.execCommand.split(/\s+/);
				const devcontainerCmd = execParts[0] || 'devcontainer';
				const execArgs = execParts.slice(1);

				// Build the full command: devcontainer exec [args] -- [preset command] [preset args]
				const fullArgs = [
					...execArgs,
					'--',
					preset.command,
					...(preset.args || []),
				];

				// Spawn the process within devcontainer
				const ptyProcess = await this.spawn(
					devcontainerCmd,
					fullArgs,
					worktreePath,
				);

				const commandConfig = {
					command: preset.command,
					args: preset.args,
					fallbackArgs: preset.fallbackArgs,
				};

				return this.createSessionInternal(
					worktreePath,
					ptyProcess,
					commandConfig,
					{
						isPrimaryCommand: true,
						detectionStrategy: preset.detectionStrategy,
						devcontainerConfig,
						sessionName,
						agentId: preset.id,
					},
				);
			},
			catch: (error: unknown) => {
				// If it's already a ConfigError or ProcessError, return it
				if (error instanceof ConfigError || error instanceof ProcessError) {
					return error;
				}

				// Otherwise, wrap in ProcessError
				return new ProcessError({
					command: `createSessionWithDevcontainer (${devcontainerConfig.execCommand})`,
					message:
						error instanceof Error
							? error.message
							: 'Failed to create session with devcontainer',
				});
			},
		});
	}

	static getSessionCounts(sessions: Session[]): SessionCounts {
		const counts: SessionCounts = {
			idle: 0,
			busy: 0,
			waiting_input: 0,
			pending_auto_approval: 0,
			total: sessions.length,
		};

		sessions.forEach(session => {
			const stateData = session.stateMutex.getSnapshot();
			switch (stateData.state) {
				case 'idle':
					counts.idle++;
					break;
				case 'busy':
					counts.busy++;
					break;
				case 'waiting_input':
					counts.waiting_input++;
					break;
				case 'pending_auto_approval':
					counts.pending_auto_approval++;
					break;
			}
		});

		return counts;
	}

	static formatSessionCounts(counts: SessionCounts): string {
		if (counts.total === 0) {
			return '';
		}

		const parts: string[] = [];
		if (counts.idle > 0) {
			parts.push(`${counts.idle} Idle`);
		}
		if (counts.busy > 0) {
			parts.push(`${counts.busy} Busy`);
		}
		if (counts.waiting_input > 0) {
			parts.push(`${counts.waiting_input} Waiting`);
		}

		return parts.length > 0 ? ` (${parts.join(' / ')})` : '';
	}
}
