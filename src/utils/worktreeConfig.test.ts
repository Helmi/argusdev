import {describe, it, expect, vi, beforeEach} from 'vitest';
import {Effect} from 'effect';
import {
	isWorktreeConfigEnabled,
	getWorktreeParentBranchWithSource,
} from './worktreeConfig.js';
import * as cp from 'child_process';

import * as fsSync from 'fs';

import * as nodePath from 'path';

import * as nodeOs from 'os';

vi.mock('child_process');
vi.mock('../services/worktreeConfigManager.js', () => ({
	worktreeConfigManager: {
		isAvailable: vi.fn(() => true),
	},
}));

describe('worktreeConfig', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('isWorktreeConfigEnabled', () => {
		it('should return true when worktree config is enabled', () => {
			vi.mocked(cp.execSync).mockReturnValue('true\n');

			const result = isWorktreeConfigEnabled('/test/path');

			expect(result).toBe(true);
			expect(cp.execSync).toHaveBeenCalledWith(
				'git config extensions.worktreeConfig',
				{
					cwd: '/test/path',
					encoding: 'utf8',
					stdio: ['ignore', 'pipe', 'pipe'],
				},
			);
		});

		it('should return false when worktree config is disabled', () => {
			vi.mocked(cp.execSync).mockReturnValue('false\n');

			const result = isWorktreeConfigEnabled('/test/path');

			expect(result).toBe(false);
		});

		it('should return false when git config command fails', () => {
			vi.mocked(cp.execSync).mockImplementation(() => {
				throw new Error('Command failed');
			});

			const result = isWorktreeConfigEnabled('/test/path');

			expect(result).toBe(false);
		});
	});

	describe('getWorktreeParentBranchWithSource — integration', () => {
		// Uses real git repos: execFileAsync captures execFile at module load time,
		// so vi.mock interception doesn't reach through promisify wrappers.
		// We use a real execSync (not the mocked cp.execSync) for repo setup.
		const realExecSync = vi
			.importActual<typeof import('child_process')>('child_process')
			.then(m => m.execSync);

		async function makeRepo(): Promise<string> {
			const exec = await realExecSync;
			const dir = fsSync.mkdtempSync(
				nodePath.join(nodeOs.tmpdir(), 'argusdev-wc-'),
			);
			exec('git init', {cwd: dir, stdio: 'pipe'});
			exec('git config user.email "t@t.com"', {cwd: dir, stdio: 'pipe'});
			exec('git config user.name "T"', {cwd: dir, stdio: 'pipe'});
			exec('git config commit.gpgsign false', {cwd: dir, stdio: 'pipe'});
			fsSync.writeFileSync(nodePath.join(dir, 'f.txt'), 'x');
			exec('git add f.txt', {cwd: dir, stdio: 'pipe'});
			exec('git commit -m "init"', {cwd: dir, stdio: 'pipe'});
			return dir;
		}

		it('returns null on a single-branch repo with no config or upstream', async () => {
			const dir = await makeRepo();
			try {
				// Single branch repo, no argusdev config, no upstream
				// main == current branch so merge-base probe skips it
				const result = await Effect.runPromise(
					getWorktreeParentBranchWithSource(dir),
				);
				expect(result === null || result?.source === 'guessed').toBe(true);
			} finally {
				fsSync.rmSync(dir, {recursive: true, force: true});
			}
		});

		it('returns config source when argusdev.parentBranch is set', async () => {
			const exec = await realExecSync;
			const dir = await makeRepo();
			try {
				exec('git config extensions.worktreeConfig true', {
					cwd: dir,
					stdio: 'pipe',
				});
				exec('git config --worktree argusdev.parentBranch develop', {
					cwd: dir,
					stdio: 'pipe',
				});
				const result = await Effect.runPromise(
					getWorktreeParentBranchWithSource(dir),
				);
				expect(result).toEqual({branch: 'develop', source: 'config'});
			} finally {
				fsSync.rmSync(dir, {recursive: true, force: true});
			}
		});

		it('returns guessed source for a feature branch when main exists', async () => {
			const exec = await realExecSync;
			const dir = await makeRepo();
			try {
				exec('git checkout -b feat/thing', {cwd: dir, stdio: 'pipe'});
				fsSync.writeFileSync(nodePath.join(dir, 'g.txt'), 'y');
				exec('git add g.txt', {cwd: dir, stdio: 'pipe'});
				exec('git commit -m "feat"', {cwd: dir, stdio: 'pipe'});
				const result = await Effect.runPromise(
					getWorktreeParentBranchWithSource(dir),
				);
				expect(result?.source).toBe('guessed');
				expect(['main', 'master']).toContain(result?.branch);
			} finally {
				fsSync.rmSync(dir, {recursive: true, force: true});
			}
		});
	});
});
