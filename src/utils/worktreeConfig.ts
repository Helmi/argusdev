import {promisify} from 'util';
import {execSync, execFile} from 'child_process';
import {Effect} from 'effect';
import {GitError} from '../types/errors.js';
import {worktreeConfigManager} from '../services/worktreeConfigManager.js';

const execFileAsync = promisify(execFile);

export type ParentBranchSource = 'config' | 'upstream' | 'guessed';

export interface ParentBranchResult {
	branch: string;
	source: ParentBranchSource;
}

export function isWorktreeConfigEnabled(gitPath?: string): boolean {
	try {
		const result = execSync('git config extensions.worktreeConfig', {
			cwd: gitPath || process.cwd(),
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		}).trim();
		return result === 'true';
	} catch {
		return false;
	}
}

function tryGit(
	args: string[],
	cwd: string,
	signal?: AbortSignal,
): Promise<string | null> {
	return execFileAsync('git', args, {cwd, encoding: 'utf8', signal})
		.then(r => r.stdout.trim() || null)
		.catch(() => null);
}

function fromArgusdevConfig(
	worktreePath: string,
	signal?: AbortSignal,
): Promise<string | null> {
	if (!worktreeConfigManager.isAvailable()) return Promise.resolve(null);
	return tryGit(
		['config', '--worktree', 'argusdev.parentBranch'],
		worktreePath,
		signal,
	);
}

async function fromUpstream(
	worktreePath: string,
	signal?: AbortSignal,
): Promise<string | null> {
	const raw = await tryGit(
		['rev-parse', '--abbrev-ref', '@{upstream}'],
		worktreePath,
		signal,
	);
	if (!raw) return null;
	const upstream = raw.replace(/^[^/]+\//, '') || null;
	if (!upstream) return null;
	// If the upstream branch has the same name as the current branch (e.g. after
	// `git push -u origin feat/foo`), it's not a parent — fall through to merge-base.
	const currentBranch = await tryGit(
		['branch', '--show-current'],
		worktreePath,
		signal,
	);
	if (upstream === currentBranch) return null;
	return upstream;
}

async function fromMergeBase(
	worktreePath: string,
	signal?: AbortSignal,
): Promise<string | null> {
	const currentBranch = await tryGit(
		['branch', '--show-current'],
		worktreePath,
		signal,
	);
	if (!currentBranch) return null;

	const candidates = ['main', 'master', 'develop'];
	let bestCandidate: string | null = null;
	let bestDepth = Infinity;

	for (const candidate of candidates) {
		if (candidate === currentBranch) continue;
		const exists = await tryGit(
			['rev-parse', '--verify', candidate],
			worktreePath,
			signal,
		);
		if (!exists) continue;

		const countRaw = await tryGit(
			['rev-list', '--count', `${candidate}..HEAD`],
			worktreePath,
			signal,
		);
		const depth = countRaw ? Number.parseInt(countRaw, 10) : Infinity;
		if (!Number.isNaN(depth) && depth < bestDepth) {
			bestDepth = depth;
			bestCandidate = candidate;
		}
	}

	return bestCandidate;
}

/**
 * Get parent branch for a worktree using a three-step fallback chain:
 * 1. git config --worktree argusdev.parentBranch (set by argusdev on worktree creation)
 * 2. @{upstream} tracking branch
 * 3. Merge-base probe against main/master/develop (best guess)
 */
export function getWorktreeParentBranch(
	worktreePath: string,
): Effect.Effect<string | null, never> {
	return Effect.catchAll(
		Effect.tryPromise({
			try: async signal => {
				const fromConfig = await fromArgusdevConfig(worktreePath, signal);
				if (fromConfig) return fromConfig;

				const fromUp = await fromUpstream(worktreePath, signal);
				if (fromUp) return fromUp;

				return fromMergeBase(worktreePath, signal);
			},
			catch: error => error,
		}),
		error => {
			if (isAbortError(error)) return Effect.interrupt;
			return Effect.succeed<string | null>(null);
		},
	);
}

/**
 * Get parent branch with source attribution for UI display.
 */
export function getWorktreeParentBranchWithSource(
	worktreePath: string,
): Effect.Effect<ParentBranchResult | null, never> {
	return Effect.catchAll(
		Effect.tryPromise({
			try: async signal => {
				const fromConfig = await fromArgusdevConfig(worktreePath, signal);
				if (fromConfig) return {branch: fromConfig, source: 'config' as const};

				const fromUp = await fromUpstream(worktreePath, signal);
				if (fromUp) return {branch: fromUp, source: 'upstream' as const};

				const guessed = await fromMergeBase(worktreePath, signal);
				if (guessed) return {branch: guessed, source: 'guessed' as const};

				return null;
			},
			catch: error => error,
		}),
		error => {
			if (isAbortError(error)) return Effect.interrupt;
			return Effect.succeed<ParentBranchResult | null>(null);
		},
	);
}

export function setWorktreeParentBranch(
	worktreePath: string,
	parentBranch: string,
): Effect.Effect<void, GitError> {
	if (!worktreeConfigManager.isAvailable()) {
		return Effect.void;
	}

	const command = `git config --worktree argusdev.parentBranch ${parentBranch}`;
	return Effect.catchAll(
		Effect.tryPromise({
			try: signal =>
				execFileAsync(
					'git',
					['config', '--worktree', 'argusdev.parentBranch', parentBranch],
					{
						cwd: worktreePath,
						encoding: 'utf8',
						signal,
					},
				).then(() => undefined),
			catch: error => error,
		}),
		error => {
			if (isAbortError(error)) {
				return Effect.interrupt as Effect.Effect<void, GitError>;
			}
			return Effect.fail(toGitError(command, error));
		},
	);
}

function isAbortError(error: unknown): boolean {
	if (error instanceof Error && error.name === 'AbortError') {
		return true;
	}

	if (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as {code?: unknown}).code === 'ABORT_ERR'
	) {
		return true;
	}

	return false;
}

function toGitError(command: string, error: unknown): GitError {
	if (error instanceof GitError) {
		return error;
	}

	if (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		'stderr' in error
	) {
		const execError = error as {
			code?: string | number;
			stderr?: string;
			stdout?: string;
			message?: string;
		};
		const exitCode =
			typeof execError.code === 'number'
				? execError.code
				: Number.parseInt(String(execError.code ?? '-1'), 10) || -1;
		const stderr =
			typeof execError.stderr === 'string'
				? execError.stderr
				: (execError.message ?? '');

		return new GitError({
			command,
			exitCode,
			stderr,
			stdout:
				typeof execError.stdout === 'string' && execError.stdout.length > 0
					? execError.stdout
					: undefined,
		});
	}

	if (error instanceof Error) {
		return new GitError({
			command,
			exitCode: -1,
			stderr: error.message,
		});
	}

	return new GitError({
		command,
		exitCode: -1,
		stderr: String(error),
	});
}
