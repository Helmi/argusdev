import {dirname, isAbsolute, join, resolve} from 'path';
import {readdir, readFile, stat, unlink, writeFile, mkdir} from 'fs/promises';
import type {Dirent} from 'fs';

const GITDIR_PREFIX = 'gitdir:';

const STARTUP_SCRIPT_PREFIX = '.cacd-startup-';
const STARTUP_SCRIPT_SUFFIX = '.sh';

export const STARTUP_SCRIPT_NAME_PATTERN = new RegExp(
	`^${STARTUP_SCRIPT_PREFIX.replace(/[.*+?^${}()|[\\]{}]/g, '\\$&')}.*${STARTUP_SCRIPT_SUFFIX.replace(/[.*+?^${}()|[\\]{}]/g, '\\$&')}$`,
);

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}

export async function resolveGitDirectoryPath(
	worktreePath: string,
): Promise<string | undefined> {
	const gitPath = join(worktreePath, '.git');
	try {
		const gitPathStat = await stat(gitPath);
		if (gitPathStat.isDirectory()) {
			return gitPath;
		}

		if (!gitPathStat.isFile()) {
			return undefined;
		}

		const gitPointer = await readFile(gitPath, 'utf-8');
		const gitDirLine = gitPointer.split('\n')[0]?.trim();
		if (!gitDirLine?.startsWith(GITDIR_PREFIX)) {
			return undefined;
		}

		const rawGitDir = gitDirLine.slice(GITDIR_PREFIX.length).trim();
		if (!rawGitDir) {
			return undefined;
		}

		const resolvedGitDir = isAbsolute(rawGitDir)
			? rawGitDir
			: resolve(dirname(gitPath), rawGitDir);
		const resolvedStat = await stat(resolvedGitDir);
		return resolvedStat.isDirectory() ? resolvedGitDir : undefined;
	} catch (error) {
		if (isErrnoException(error) && error.code === 'ENOENT') {
			return undefined;
		}
		return undefined;
	}
}

export async function ensureStartupScriptInGitExclude(
	worktreePath: string,
	scriptFileName: string,
): Promise<boolean> {
	const gitDirectoryPath = await resolveGitDirectoryPath(worktreePath);
	if (!gitDirectoryPath) {
		return false;
	}

	const excludePath = join(gitDirectoryPath, 'info', 'exclude');
	await mkdir(dirname(excludePath), {recursive: true});

	let excludeContents = '';
	try {
		excludeContents = await readFile(excludePath, 'utf-8');
	} catch (error) {
		if (!isErrnoException(error) || error.code !== 'ENOENT') {
			return false;
		}
	}

	const lines = excludeContents.split('\n').map(line => line.trim());
	if (lines.includes(scriptFileName)) {
		return true;
	}

	const separator =
		excludeContents.length === 0 || excludeContents.endsWith('\n') ? '' : '\n';
	await writeFile(
		excludePath,
		`${excludeContents}${separator}${scriptFileName}\n`,
		'utf-8',
	);
	return true;
}

export async function cleanupStartupScriptsInWorktree(
	worktreePath: string,
	maxAgeMs: number,
	now: number = Date.now(),
): Promise<number> {
	let removed = 0;
	const staleBefore = now - maxAgeMs;
	let entries: Dirent[] = [];
	try {
		entries = await readdir(worktreePath, {
			withFileTypes: true,
			encoding: 'utf-8',
		});
	} catch {
		return removed;
	}

	for (const entry of entries) {
		if (!entry.isFile() || !STARTUP_SCRIPT_NAME_PATTERN.test(entry.name)) {
			continue;
		}

		const scriptPath = join(worktreePath, entry.name);
		try {
			const scriptStat = await stat(scriptPath);
			if (scriptStat.mtimeMs >= staleBefore) {
				continue;
			}

			await unlink(scriptPath);
			removed += 1;
		} catch {
			// Ignore files that disappear while we inspect or cannot be removed.
		}
	}

	return removed;
}
