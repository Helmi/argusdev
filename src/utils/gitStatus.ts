import {promisify} from 'util';
import {execFile, type ExecException} from 'child_process';
import {Effect, Either} from 'effect';
import {pipe} from 'effect/Function';
import {GitError} from '../types/errors.js';
import {
	getWorktreeParentBranchWithSource,
	type ParentBranchSource,
	type ParentBranchResult,
} from './worktreeConfig.js';
import {createEffectConcurrencyLimited} from './concurrencyLimit.js';
import {validatePathWithinBase} from './pathValidation.js';

const execFileAsync = promisify(execFile);

export interface GitStatus {
	filesAdded: number;
	filesDeleted: number;
	aheadCount: number;
	behindCount: number;
	parentBranch: string | null;
	parentBranchSource: ParentBranchSource | null;
}

export type {ParentBranchSource};

export interface ChangedFile {
	path: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
	additions: number;
	deletions: number;
}

export interface ChangedFilesSummary {
	totalFiles: number;
	totalAdditions: number;
	totalDeletions: number;
	byStatus: Record<ChangedFile['status'], number>;
}

export interface ChangedFilesResponse {
	files: ChangedFile[];
	summary: ChangedFilesSummary;
	total: number;
	truncated: boolean;
}

interface ExecResult {
	stdout: string;
	stderr: string;
}

interface GitStats {
	insertions: number;
	deletions: number;
}

const DEFAULT_GIT_STATS: GitStats = {insertions: 0, deletions: 0};

/**
 * Get comprehensive Git status for a worktree
 *
 * Retrieves file changes, ahead/behind counts, and parent branch information
 * using Effect-based error handling.
 *
 * @param {string} worktreePath - Absolute path to the worktree directory
 * @returns {Effect.Effect<GitStatus, GitError>} Effect containing git status or GitError
 *
 * @example
 * ```typescript
 * import {Effect} from 'effect';
 * import {getGitStatus} from './utils/gitStatus.js';
 *
 * // Execute with Effect.runPromise
 * const status = await Effect.runPromise(
 *   getGitStatus('/path/to/worktree')
 * );
 * console.log(`Files added: ${status.filesAdded}, deleted: ${status.filesDeleted}`);
 * console.log(`Ahead: ${status.aheadCount}, behind: ${status.behindCount}`);
 *
 * // Or use Effect.map for transformation
 * const formatted = await Effect.runPromise(
 *   Effect.map(
 *     getGitStatus('/path/to/worktree'),
 *     (status) => `+${status.filesAdded} -${status.filesDeleted}`
 *   )
 * );
 * ```
 *
 * @throws {GitError} When git commands fail or worktree path is invalid
 */
export const getGitStatus = (
	worktreePath: string,
): Effect.Effect<GitStatus, GitError> =>
	Effect.gen(function* () {
		const diffResult = yield* runGit(['diff', '--shortstat'], worktreePath);
		const stagedResult = yield* runGit(
			['diff', '--staged', '--shortstat'],
			worktreePath,
		);
		const branchResult = yield* runGit(
			['branch', '--show-current'],
			worktreePath,
		);
		const parentBranchResult = yield* fetchParentBranch(worktreePath);
		const parentBranch = parentBranchResult?.branch ?? null;
		const parentBranchSource = parentBranchResult?.source ?? null;

		const diffStats = decodeGitStats(diffResult.stdout);
		const stagedStats = decodeGitStats(stagedResult.stdout);

		const filesAdded = diffStats.insertions + stagedStats.insertions;
		const filesDeleted = diffStats.deletions + stagedStats.deletions;

		const {aheadCount, behindCount} = yield* computeAheadBehind({
			worktreePath,
			currentBranch: branchResult.stdout.trim(),
			parentBranch,
		});

		return {
			filesAdded,
			filesDeleted,
			aheadCount,
			behindCount,
			parentBranch,
			parentBranchSource,
		};
	});

export const getGitStatusLimited = createEffectConcurrencyLimited(
	(worktreePath: string) => getGitStatus(worktreePath),
	10,
);

export function formatGitFileChanges(status: GitStatus): string {
	const parts: string[] = [];

	const colors = {
		green: '\x1b[32m',
		red: '\x1b[31m',
		reset: '\x1b[0m',
	};

	if (status.filesAdded > 0) {
		parts.push(`${colors.green}+${status.filesAdded}${colors.reset}`);
	}
	if (status.filesDeleted > 0) {
		parts.push(`${colors.red}-${status.filesDeleted}${colors.reset}`);
	}

	return parts.join(' ');
}

export function formatGitAheadBehind(status: GitStatus): string {
	const parts: string[] = [];

	const colors = {
		cyan: '\x1b[36m',
		magenta: '\x1b[35m',
		reset: '\x1b[0m',
	};

	if (status.aheadCount > 0) {
		parts.push(`${colors.cyan}↑${status.aheadCount}${colors.reset}`);
	}
	if (status.behindCount > 0) {
		parts.push(`${colors.magenta}↓${status.behindCount}${colors.reset}`);
	}

	return parts.join(' ');
}

export function formatGitStatus(status: GitStatus): string {
	const fileChanges = formatGitFileChanges(status);
	const aheadBehind = formatGitAheadBehind(status);

	const parts = [];
	if (fileChanges) parts.push(fileChanges);
	if (aheadBehind) parts.push(aheadBehind);

	return parts.join(' ');
}

export function formatParentBranch(
	parentBranch: string | null,
	currentBranch: string,
): string {
	if (!parentBranch || parentBranch === currentBranch) {
		return '';
	}

	const colors = {
		dim: '\x1b[90m',
		reset: '\x1b[0m',
	};

	return `${colors.dim}(${parentBranch})${colors.reset}`;
}

function runGit(
	args: string[],
	worktreePath: string,
): Effect.Effect<ExecResult, GitError> {
	const command = `git ${args.join(' ')}`.trim();
	return Effect.catchAll(
		Effect.tryPromise({
			try: signal =>
				execFileAsync('git', args, {
					cwd: worktreePath,
					encoding: 'utf8',
					maxBuffer: 5 * 1024 * 1024,
					signal,
				}),
			catch: error => error,
		}),
		error => handleExecFailure(command, error),
	);
}

function fetchParentBranch(
	worktreePath: string,
): Effect.Effect<ParentBranchResult | null> {
	return Effect.catchAll(getWorktreeParentBranchWithSource(worktreePath), () =>
		Effect.succeed<ParentBranchResult | null>(null),
	);
}

function computeAheadBehind({
	worktreePath,
	currentBranch,
	parentBranch,
}: {
	worktreePath: string;
	currentBranch: string;
	parentBranch: string | null;
}): Effect.Effect<{aheadCount: number; behindCount: number}, GitError> {
	if (!currentBranch || !parentBranch || currentBranch === parentBranch) {
		return Effect.succeed({aheadCount: 0, behindCount: 0});
	}

	return Effect.map(
		Effect.catchAll(
			runGit(
				['rev-list', '--left-right', '--count', `${parentBranch}...HEAD`],
				worktreePath,
			),
			() => Effect.succeed<ExecResult>({stdout: '', stderr: ''}),
		),
		result => decodeAheadBehind(result.stdout),
	);
}

function parseGitStats(statLine: string): Either.Either<GitStats, string> {
	const insertMatch = statLine.match(/(\d+) insertion/);
	const deleteMatch = statLine.match(/(\d+) deletion/);

	const insertions = insertMatch?.[1]
		? Number.parseInt(insertMatch[1]!, 10)
		: 0;
	const deletions = deleteMatch?.[1] ? Number.parseInt(deleteMatch[1]!, 10) : 0;

	if (Number.isNaN(insertions) || Number.isNaN(deletions)) {
		return Either.left(
			`Unable to parse git diff stats from "${statLine.trim()}"`,
		);
	}

	return Either.right({insertions, deletions});
}

function decodeGitStats(statLine: string): GitStats {
	return pipe(
		parseGitStats(statLine),
		Either.getOrElse(() => DEFAULT_GIT_STATS),
	);
}

function parseAheadBehind(
	stats: string,
): Either.Either<{aheadCount: number; behindCount: number}, string> {
	const trimmed = stats.trim();
	if (!trimmed) {
		return Either.right({aheadCount: 0, behindCount: 0});
	}

	const [behindRaw, aheadRaw] = trimmed.split('\t');
	const behind = behindRaw ? Number.parseInt(behindRaw, 10) : 0;
	const ahead = aheadRaw ? Number.parseInt(aheadRaw, 10) : 0;

	if (Number.isNaN(behind) || Number.isNaN(ahead)) {
		return Either.left(`Unable to parse ahead/behind stats from "${trimmed}"`);
	}

	return Either.right({
		aheadCount: Math.max(ahead, 0),
		behindCount: Math.max(behind, 0),
	});
}

function decodeAheadBehind(stats: string): {
	aheadCount: number;
	behindCount: number;
} {
	return pipe(
		parseAheadBehind(stats),
		Either.getOrElse(() => ({aheadCount: 0, behindCount: 0})),
	);
}

function handleExecFailure(
	command: string,
	error: unknown,
): Effect.Effect<ExecResult, GitError> {
	if (isAbortError(error)) {
		return Effect.interrupt as Effect.Effect<ExecResult, GitError>;
	}

	return Effect.fail(toGitError(command, error));
}

function isExecError(error: unknown): error is ExecException & {
	stdout?: string;
	stderr?: string;
	code?: string | number | null;
	killed?: boolean;
	signal?: NodeJS.Signals;
} {
	return (
		typeof error === 'object' &&
		error !== null &&
		'message' in error &&
		'code' in error
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

	if (isExecError(error)) {
		return Boolean(error.killed && error.signal);
	}

	return false;
}

function toGitError(command: string, error: unknown): GitError {
	if (error instanceof GitError) {
		return error;
	}

	if (isExecError(error)) {
		const exitCodeRaw = error.code;
		const exitCode =
			typeof exitCodeRaw === 'number'
				? exitCodeRaw
				: Number.parseInt(String(exitCodeRaw ?? '-1'), 10) || -1;
		const stderr =
			typeof error.stderr === 'string' ? error.stderr : (error.message ?? '');

		return new GitError({
			command,
			exitCode,
			stderr,
			stdout:
				typeof error.stdout === 'string' && error.stdout.length > 0
					? error.stdout
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

/**
 * Get list of changed files in a worktree with their status and line counts
 *
 * @param {string} worktreePath - Absolute path to the worktree directory
 * @returns {Effect.Effect<ChangedFile[], GitError>} Effect containing list of changed files
 */
export const getChangedFiles = (
	worktreePath: string,
): Effect.Effect<ChangedFile[], GitError> =>
	Effect.gen(function* () {
		// Get staged and unstaged changes with numstat
		const stagedResult = yield* runGit(
			['diff', '--staged', '--numstat'],
			worktreePath,
		);
		const unstagedResult = yield* runGit(['diff', '--numstat'], worktreePath);

		// Get untracked files
		const untrackedResult = yield* runGit(
			['ls-files', '--others', '--exclude-standard'],
			worktreePath,
		);

		// Get file status (for rename detection)
		const statusResult = yield* runGit(
			['status', '--porcelain', '-uno'],
			worktreePath,
		);

		const changedFiles = new Map<string, ChangedFile>();

		// Parse numstat output (additions deletions filename)
		const parseNumstat = (output: string) => {
			for (const line of output.split('\n')) {
				if (!line.trim()) continue;
				const parts = line.split('\t');
				if (parts.length >= 3) {
					const additions =
						parts[0] === '-' ? 0 : Number.parseInt(parts[0]!, 10) || 0;
					const deletions =
						parts[1] === '-' ? 0 : Number.parseInt(parts[1]!, 10) || 0;
					const filePath = parts.slice(2).join('\t'); // Handle filenames with tabs

					const existing = changedFiles.get(filePath);
					if (existing) {
						existing.additions += additions;
						existing.deletions += deletions;
					} else {
						changedFiles.set(filePath, {
							path: filePath,
							status: 'modified',
							additions,
							deletions,
						});
					}
				}
			}
		};

		parseNumstat(stagedResult.stdout);
		parseNumstat(unstagedResult.stdout);

		// Parse porcelain status to detect file status types
		for (const line of statusResult.stdout.split('\n')) {
			if (!line.trim()) continue;
			const statusCode = line.substring(0, 2);
			let filePath = line.substring(3);

			// Handle renamed files (old -> new)
			if (filePath.includes(' -> ')) {
				filePath = filePath.split(' -> ')[1]!;
			}

			const existing = changedFiles.get(filePath);
			let status: ChangedFile['status'] = 'modified';

			if (statusCode.includes('A') || statusCode === '??') {
				status = 'added';
			} else if (statusCode.includes('D')) {
				status = 'deleted';
			} else if (statusCode.includes('R')) {
				status = 'renamed';
			}

			if (existing) {
				existing.status = status;
			} else if (statusCode === '??') {
				// Untracked file
				changedFiles.set(filePath, {
					path: filePath,
					status: 'untracked',
					additions: 0,
					deletions: 0,
				});
			}
		}

		// Add untracked files without line counts
		for (const line of untrackedResult.stdout.split('\n')) {
			if (!line.trim()) continue;
			if (!changedFiles.has(line)) {
				changedFiles.set(line, {
					path: line,
					status: 'untracked',
					additions: 0,
					deletions: 0,
				});
			}
		}

		return Array.from(changedFiles.values()).sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	});

export const getChangedFilesLimited = createEffectConcurrencyLimited(
	(worktreePath: string) => getChangedFiles(worktreePath),
	10,
);

export const getChangedFilesWithSummary = (
	worktreePath: string,
	options?: {limit?: number; search?: string},
): Effect.Effect<ChangedFilesResponse, GitError> =>
	Effect.map(getChangedFiles(worktreePath), allFiles => {
		const summary: ChangedFilesSummary = {
			totalFiles: allFiles.length,
			totalAdditions: allFiles.reduce((s, f) => s + f.additions, 0),
			totalDeletions: allFiles.reduce((s, f) => s + f.deletions, 0),
			byStatus: {added: 0, modified: 0, deleted: 0, renamed: 0, untracked: 0},
		};
		for (const f of allFiles) summary.byStatus[f.status]++;

		const filtered = options?.search
			? allFiles.filter(f =>
					f.path.toLowerCase().includes(options.search!.toLowerCase()),
				)
			: allFiles;

		const limit = options?.limit ?? allFiles.length;
		const files = filtered.slice(0, limit);

		return {
			files,
			summary,
			total: filtered.length,
			truncated: files.length < filtered.length,
		};
	});

export const getChangedFilesWithSummaryLimited = createEffectConcurrencyLimited(
	(worktreePath: string, options?: {limit?: number; search?: string}) =>
		getChangedFilesWithSummary(worktreePath, options),
	10,
);

/**
 * Get unified diff for a specific file in a worktree
 *
 * @param {string} worktreePath - Absolute path to the worktree directory
 * @param {string} filePath - Relative path to the file within the worktree
 * @returns {Effect.Effect<string, GitError>} Effect containing the unified diff output
 */
export const getFileDiff = (
	worktreePath: string,
	filePath: string,
): Effect.Effect<string, GitError> =>
	Effect.gen(function* () {
		// Defense-in-depth: validate filePath doesn't escape worktree
		// (caller should have validated, but check here too)
		let validatedFullPath: string;
		try {
			validatedFullPath = validatePathWithinBase(worktreePath, filePath);
		} catch (_error) {
			return yield* Effect.fail(
				new GitError({
					command: `validate ${filePath}`,
					exitCode: -1,
					stderr: 'Path traversal detected',
				}),
			);
		}

		// Check if file is untracked
		const statusResult = yield* runGit(
			['status', '--porcelain', '--', filePath],
			worktreePath,
		);

		const statusLine = statusResult.stdout.trim();
		if (statusLine.startsWith('??')) {
			// Untracked file - show entire content as added
			const contentResult = yield* Effect.catchAll(
				runGit(['show', `:${filePath}`], worktreePath),
				() =>
					// File not staged, read from disk
					Effect.tryPromise({
						try: async () => {
							const fs = await import('fs/promises');
							const content = await fs.readFile(validatedFullPath, 'utf8');
							return {stdout: content, stderr: ''};
						},
						catch: error =>
							new GitError({
								command: `read ${filePath}`,
								exitCode: -1,
								stderr: String(error),
							}),
					}),
			);

			// Format as diff
			const lines = contentResult.stdout.split('\n');
			const diffLines = [
				`diff --git a/${filePath} b/${filePath}`,
				'new file mode 100644',
				'--- /dev/null',
				`+++ b/${filePath}`,
				`@@ -0,0 +1,${lines.length} @@`,
				...lines.map(line => `+${line}`),
			];
			return diffLines.join('\n');
		}

		// Get combined staged and unstaged diff
		const stagedDiff = yield* Effect.catchAll(
			runGit(['diff', '--staged', '--', filePath], worktreePath),
			() => Effect.succeed<ExecResult>({stdout: '', stderr: ''}),
		);

		const unstagedDiff = yield* Effect.catchAll(
			runGit(['diff', '--', filePath], worktreePath),
			() => Effect.succeed<ExecResult>({stdout: '', stderr: ''}),
		);

		// Combine diffs (prefer showing both if both exist)
		if (stagedDiff.stdout && unstagedDiff.stdout) {
			return `${stagedDiff.stdout}\n\n--- Unstaged changes ---\n\n${unstagedDiff.stdout}`;
		}

		return stagedDiff.stdout || unstagedDiff.stdout || '';
	});
