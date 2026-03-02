import {describe, it, expect} from 'vitest';
import {tmpdir} from 'os';
import {join} from 'path';
import {
	cleanupStartupScriptsInWorktree,
	resolveGitDirectoryPath,
	ensureStartupScriptInGitExclude,
	STARTUP_SCRIPT_NAME_PATTERN,
} from './startupScript.js';
import {mkdtemp, mkdir, readFile, writeFile, utimes, rm} from 'fs/promises';

describe('startupScript utilities', () => {
	it('should resolve a regular .git directory', async () => {
		const worktreePath = await mkdtemp(join(tmpdir(), 'cacd-startup-test-'));
		await mkdir(join(worktreePath, '.git'), {recursive: true});

		const gitDir = await resolveGitDirectoryPath(worktreePath);
		expect(gitDir).toBe(join(worktreePath, '.git'));

		await rm(worktreePath, {recursive: true, force: true});
	});

	it('should resolve a relative gitdir pointer', async () => {
		const root = await mkdtemp(join(tmpdir(), 'cacd-startup-pointer-'));
		const worktreePath = join(root, 'worktree');
		const realGitDir = join(root, 'real-git');

		await mkdir(worktreePath, {recursive: true});
		await mkdir(join(realGitDir, 'info'), {recursive: true});
		await writeFile(
			join(worktreePath, '.git'),
			'gitdir: ../real-git\n',
			'utf-8',
		);

		const gitDir = await resolveGitDirectoryPath(worktreePath);
		expect(gitDir).toBe(realGitDir);

		await rm(root, {recursive: true, force: true});
	});

	it('should add startup script path to .git/info/exclude', async () => {
		const worktreePath = await mkdtemp(join(tmpdir(), 'cacd-startup-ignore-'));
		const excludePath = join(worktreePath, '.git', 'info', 'exclude');
		await mkdir(join(worktreePath, '.git', 'info'), {recursive: true});
		await writeFile(excludePath, '# managed\n', 'utf-8');

		await ensureStartupScriptInGitExclude(
			worktreePath,
			'.cacd-startup-demo.sh',
		);
		const afterFirst = await readFile(excludePath, 'utf-8');
		expect(afterFirst).toContain('.cacd-startup-demo.sh');

		await ensureStartupScriptInGitExclude(
			worktreePath,
			'.cacd-startup-demo.sh',
		);
		const afterSecond = await readFile(excludePath, 'utf-8');
		expect(afterSecond).toContain('.cacd-startup-demo.sh');
		expect(
			afterSecond
				.split('\n')
				.filter(line => line.trim() === '.cacd-startup-demo.sh').length,
		).toBe(1);

		await rm(worktreePath, {recursive: true, force: true});
	});

	it('should add launcher entries even when using a gitdir pointer', async () => {
		const root = await mkdtemp(join(tmpdir(), 'cacd-startup-pointer-exclude-'));
		const worktreePath = join(root, 'worktree');
		const realGitDir = join(root, 'real-git');

		await mkdir(worktreePath, {recursive: true});
		await mkdir(join(realGitDir, 'info'), {recursive: true});
		await writeFile(
			join(worktreePath, '.git'),
			'gitdir: ../real-git\n',
			'utf-8',
		);

		const added = await ensureStartupScriptInGitExclude(
			worktreePath,
			'.cacd-startup-pointer.sh',
		);
		expect(added).toBe(true);
		const excludeContents = await readFile(
			join(realGitDir, 'info', 'exclude'),
			'utf-8',
		);
		expect(excludeContents).toContain('.cacd-startup-pointer.sh');

		await rm(root, {recursive: true, force: true});
	});

	it('should clean up stale startup scripts and keep fresh ones', async () => {
		const worktreePath = await mkdtemp(join(tmpdir(), 'cacd-startup-cleanup-'));
		const now = Date.now();
		const staleScript = join(worktreePath, '.cacd-startup-stale.sh');
		const freshScript = join(worktreePath, '.cacd-startup-fresh.sh');
		const otherScript = join(worktreePath, '.cacd-not-a-launcher.sh');

		await writeFile(staleScript, 'echo stale\n', 'utf-8');
		await writeFile(freshScript, 'echo fresh\n', 'utf-8');
		await writeFile(otherScript, 'echo other\n', 'utf-8');

		const staleTime = new Date(now - 2 * 60 * 60 * 1000);
		const freshTime = new Date(now - 30 * 60 * 1000);
		await utimes(staleScript, staleTime, staleTime);
		await utimes(freshScript, freshTime, freshTime);

		const removed = await cleanupStartupScriptsInWorktree(
			worktreePath,
			60 * 60 * 1000,
			now,
		);
		expect(removed).toBe(1);
		expect(await existsAsync(staleScript)).toBe(false);
		expect(await existsAsync(freshScript)).toBe(true);
		expect(await existsAsync(otherScript)).toBe(true);

		await rm(worktreePath, {recursive: true, force: true});
	});

	it('should ignore missing worktree directories during cleanup', async () => {
		const removed = await cleanupStartupScriptsInWorktree(
			join(tmpdir(), `missing-${Date.now()}`),
			60 * 60 * 1000,
		);
		expect(removed).toBe(0);
	});

	it('should expose a launcher filename pattern', () => {
		expect(STARTUP_SCRIPT_NAME_PATTERN.test('.cacd-startup-123.sh')).toBe(true);
		expect(STARTUP_SCRIPT_NAME_PATTERN.test('other.sh')).toBe(false);
	});
});

async function existsAsync(pathValue: string): Promise<boolean> {
	try {
		await readFile(pathValue);
		return true;
	} catch {
		return false;
	}
}
