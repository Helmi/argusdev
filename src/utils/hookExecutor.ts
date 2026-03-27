import {spawn} from 'child_process';
import {Effect} from 'effect';
import {ProcessError} from '../types/errors.js';
import {Worktree, Session, SessionState} from '../types/index.js';
import {WorktreeService} from '../services/worktreeService.js';
import {configurationManager} from '../services/configurationManager.js';

export interface HookEnvironment {
	ARGUSDEV_WORKTREE_PATH: string;
	ARGUSDEV_WORKTREE_BRANCH: string;
	ARGUSDEV_GIT_ROOT: string;
	ARGUSDEV_BASE_BRANCH?: string;
	[key: string]: string | undefined;
}

/**
 * Execute a hook command with the provided environment variables using Effect
 *
 * Spawns a shell process to run the hook command with custom environment.
 * Errors are captured but hook failures don't propagate to prevent breaking main flow.
 *
 * @param {string} command - Shell command to execute
 * @param {string} cwd - Working directory for command execution
 * @param {HookEnvironment} environment - Environment variables for the hook
 * @returns {Effect.Effect<void, ProcessError, never>} Effect that succeeds on hook completion or fails with ProcessError
 *
 * @example
 * ```typescript
 * import {Effect} from 'effect';
 * import {executeHook} from './utils/hookExecutor.js';
 *
 * const env = {
 *   ARGUSDEV_WORKTREE_PATH: '/path/to/worktree',
 *   ARGUSDEV_WORKTREE_BRANCH: 'feature-branch',
 *   ARGUSDEV_GIT_ROOT: '/path/to/repo'
 * };
 *
 * // Execute hook with error recovery
 * const result = await Effect.runPromise(
 *   Effect.catchAll(
 *     executeHook('npm install', '/path/to/worktree', env),
 *     (error) => {
 *       console.error(`Hook failed: ${error.message}`);
 *       return Effect.succeed(undefined); // Continue despite error
 *     }
 *   )
 * );
 * ```
 */
export function executeHook(
	command: string,
	cwd: string,
	environment: HookEnvironment,
): Effect.Effect<void, ProcessError> {
	return Effect.async<void, ProcessError>(resume => {
		// Use spawn with shell to execute the command and wait for all child processes
		// INTENTIONAL: shell: true is required here — user-configured hook
		// commands need shell features (pipes, &&, variable expansion).
		// Untrusted data is passed via environment variables, not interpolated
		// into the command string. Safe per Unix conventions.
		const child = spawn(command, [], {
			cwd,
			env: {
				...process.env,
				...environment,
			},
			shell: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let stderr = '';

		// Collect stderr for logging
		child.stderr?.on('data', data => {
			stderr += data.toString();
		});

		// Wait for the process and all its children to exit
		child.on('exit', (code, signal) => {
			if (code !== 0 || signal) {
				const errorMessage = signal
					? `Hook terminated by signal ${signal}`
					: `Hook exited with code ${code}`;

				resume(
					Effect.fail(
						new ProcessError({
							command,
							exitCode: code ?? undefined,
							signal: signal ?? undefined,
							message: stderr
								? `${errorMessage}\nStderr: ${stderr}`
								: errorMessage,
						}),
					),
				);
				return;
			}
			// When exit code is 0, ignore stderr and resolve successfully
			resume(Effect.void);
		});

		// Handle errors in spawning the process
		child.on('error', error => {
			resume(
				Effect.fail(
					new ProcessError({
						command,
						message: error.message,
					}),
				),
			);
		});
	});
}

/**
 * Execute a worktree post-creation hook using Effect
 * Errors are caught and logged but do not break the main flow
 */
export function executeWorktreePostCreationHook(
	command: string,
	worktree: Worktree,
	gitRoot: string,
	baseBranch?: string,
): Effect.Effect<void, never> {
	const environment: HookEnvironment = {
		ARGUSDEV_WORKTREE_PATH: worktree.path,
		ARGUSDEV_WORKTREE_BRANCH: worktree.branch || 'unknown',
		ARGUSDEV_GIT_ROOT: gitRoot,
	};

	if (baseBranch) {
		environment.ARGUSDEV_BASE_BRANCH = baseBranch;
	}

	return Effect.catchAll(
		executeHook(command, worktree.path, environment),
		error => {
			// Log error but don't throw - hooks should not break the main flow
			console.error(`Failed to execute post-creation hook: ${error.message}`);
			return Effect.void;
		},
	);
}

/**
 * Execute a session status change hook using Effect
 * Errors are caught and logged but do not break the main flow
 */
export function executeStatusHook(
	oldState: SessionState,
	newState: SessionState,
	session: Session,
): Effect.Effect<void, never> {
	const statusHooks = configurationManager.getStatusHooks();
	const hook = statusHooks[newState];

	if (!hook || !hook.enabled || !hook.command) {
		return Effect.void;
	}

	const worktreeService = new WorktreeService();

	return Effect.gen(function* () {
		// Get branch information using Effect-based method
		const worktrees = yield* Effect.catchAll(
			worktreeService.getWorktreesEffect(),
			error => {
				// Log error but continue with empty array - hooks should not break main flow
				console.error(
					`Failed to get worktrees for status hook: ${error.message || String(error)}`,
				);
				return Effect.succeed([]);
			},
		);

		const worktree = worktrees.find(wt => wt.path === session.worktreePath);
		const branch = worktree?.branch || 'unknown';

		// Build environment for status hook
		const environment: HookEnvironment = {
			ARGUSDEV_WORKTREE_PATH: session.worktreePath,
			ARGUSDEV_WORKTREE_BRANCH: branch,
			ARGUSDEV_GIT_ROOT: session.worktreePath, // For status hooks, we use worktree path as cwd
			ARGUSDEV_OLD_STATE: oldState,
			ARGUSDEV_NEW_STATE: newState,
			ARGUSDEV_SESSION_ID: session.id,
		};

		yield* Effect.catchAll(
			executeHook(hook.command, session.worktreePath, environment),
			error => {
				// Log error but don't throw - hooks should not break the main flow
				console.error(`Failed to execute ${newState} hook: ${error.message}`);
				return Effect.void;
			},
		);
	});
}

/**
 * Execute a project-local setup hook after worktree creation
 * Returns warning message if hook fails, null on success
 */
export function executeProjectSetupHook(
	command: string,
	worktreePath: string,
	env: Record<string, string>,
): Effect.Effect<string | null, never> {
	const environment: HookEnvironment = {
		ARGUSDEV_WORKTREE_PATH: worktreePath,
		ARGUSDEV_WORKTREE_BRANCH: env['ARGUSDEV_BRANCH'] || 'unknown',
		ARGUSDEV_GIT_ROOT: env['ARGUSDEV_ROOT_PATH'] || worktreePath,
		...env,
	};

	return Effect.catchAll(
		Effect.map(
			executeHook(command, worktreePath, environment),
			() => null, // Success - no warning
		),
		error => {
			// Return warning message instead of throwing
			console.error(`Setup hook failed: ${error.message}`);
			return Effect.succeed(`Setup hook failed: ${error.message}`);
		},
	);
}

/**
 * Execute a project-local teardown hook before worktree deletion
 * Returns warning message if hook fails, null on success
 */
export function executeProjectTeardownHook(
	command: string,
	worktreePath: string,
	env: Record<string, string>,
): Effect.Effect<string | null, never> {
	const environment: HookEnvironment = {
		ARGUSDEV_WORKTREE_PATH: worktreePath,
		ARGUSDEV_WORKTREE_BRANCH: env['ARGUSDEV_BRANCH'] || 'unknown',
		ARGUSDEV_GIT_ROOT: env['ARGUSDEV_ROOT_PATH'] || worktreePath,
		...env,
	};

	return Effect.catchAll(
		Effect.map(
			executeHook(command, worktreePath, environment),
			() => null, // Success - no warning
		),
		error => {
			// Return warning message instead of throwing
			console.error(`Teardown hook failed: ${error.message}`);
			return Effect.succeed(`Teardown hook failed: ${error.message}`);
		},
	);
}
