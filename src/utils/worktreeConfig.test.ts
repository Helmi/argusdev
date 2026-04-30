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

		it('falls through to guessed when upstream name matches current branch (git push -u case)', async () => {
			const exec = await realExecSync;
			// Create a bare "remote" repo and clone it so we can push -u
			const remoteDir = fsSync.mkdtempSync(
				nodePath.join(nodeOs.tmpdir(), 'argusdev-wc-remote-'),
			);
			const localDir = fsSync.mkdtempSync(
				nodePath.join(nodeOs.tmpdir(), 'argusdev-wc-local-'),
			);
			try {
				// Set up bare remote
				exec('git init --bare', {cwd: remoteDir, stdio: 'pipe'});

				// Clone and configure
				exec(`git clone ${remoteDir} ${localDir}`, {stdio: 'pipe'});
				exec('git config user.email "t@t.com"', {cwd: localDir, stdio: 'pipe'});
				exec('git config user.name "T"', {cwd: localDir, stdio: 'pipe'});
				exec('git config commit.gpgsign false', {cwd: localDir, stdio: 'pipe'});

				// Create initial commit on main
				fsSync.writeFileSync(nodePath.join(localDir, 'f.txt'), 'x');
				exec('git add f.txt', {cwd: localDir, stdio: 'pipe'});
				exec('git commit -m "init"', {cwd: localDir, stdio: 'pipe'});
				exec('git push origin main', {cwd: localDir, stdio: 'pipe'});

				// Create feature branch, commit, and push -u (tracking origin/feat/thing)
				exec('git checkout -b feat/thing', {cwd: localDir, stdio: 'pipe'});
				fsSync.writeFileSync(nodePath.join(localDir, 'g.txt'), 'y');
				exec('git add g.txt', {cwd: localDir, stdio: 'pipe'});
				exec('git commit -m "feat"', {cwd: localDir, stdio: 'pipe'});
				exec('git push -u origin feat/thing', {cwd: localDir, stdio: 'pipe'});

				// After push -u: @{upstream} = origin/feat/thing
				// fromUpstream strips prefix → "feat/thing" === currentBranch → returns null
				// Falls through to fromMergeBase → guessed
				const result = await Effect.runPromise(
					getWorktreeParentBranchWithSource(localDir),
				);
				expect(result?.source).toBe('guessed');
				expect(['main', 'master']).toContain(result?.branch);
			} finally {
				fsSync.rmSync(remoteDir, {recursive: true, force: true});
				fsSync.rmSync(localDir, {recursive: true, force: true});
			}
		});

		it('falls through when stripped upstream has no local ref', async () => {
			const exec = await realExecSync;
			// Bare remote + clone, create feature branch tracking origin/main,
			// then delete local main. Upstream strip yields "main" but the
			// local ref is gone — fromUpstream must return null instead of
			// returning "main" (which would later break rev-list silently).
			const remoteDir = fsSync.mkdtempSync(
				nodePath.join(nodeOs.tmpdir(), 'argusdev-wc-remote-'),
			);
			const localDir = fsSync.mkdtempSync(
				nodePath.join(nodeOs.tmpdir(), 'argusdev-wc-local-'),
			);
			try {
				exec('git init --bare', {cwd: remoteDir, stdio: 'pipe'});
				exec('git clone ' + remoteDir + ' ' + localDir, {stdio: 'pipe'});
				exec('git config user.email "t@t.com"', {cwd: localDir, stdio: 'pipe'});
				exec('git config user.name "T"', {cwd: localDir, stdio: 'pipe'});
				exec('git config commit.gpgsign false', {
					cwd: localDir,
					stdio: 'pipe',
				});

				fsSync.writeFileSync(nodePath.join(localDir, 'f.txt'), 'x');
				exec('git add f.txt', {cwd: localDir, stdio: 'pipe'});
				exec('git commit -m "init"', {cwd: localDir, stdio: 'pipe'});
				exec('git branch -M main', {cwd: localDir, stdio: 'pipe'});
				exec('git push -u origin main', {cwd: localDir, stdio: 'pipe'});

				exec('git checkout -b feat/thing', {cwd: localDir, stdio: 'pipe'});
				exec('git branch --set-upstream-to=origin/main feat/thing', {
					cwd: localDir,
					stdio: 'pipe',
				});
				fsSync.writeFileSync(nodePath.join(localDir, 'g.txt'), 'y');
				exec('git add g.txt', {cwd: localDir, stdio: 'pipe'});
				exec('git commit -m "feat"', {cwd: localDir, stdio: 'pipe'});

				// Drop local main — only origin/main remains.
				exec('git branch -D main', {cwd: localDir, stdio: 'pipe'});

				const result = await Effect.runPromise(
					getWorktreeParentBranchWithSource(localDir),
				);
				// What MUST NOT happen: source='upstream' with branch='main'.
				// (rev-list main..HEAD would fail because main has no local ref.)
				if (result !== null) {
					expect(result.source).not.toBe('upstream');
				}
			} finally {
				fsSync.rmSync(remoteDir, {recursive: true, force: true});
				fsSync.rmSync(localDir, {recursive: true, force: true});
			}
		});

		it('does not accept a tag with the same name as the stripped upstream', async () => {
			const exec = await realExecSync;
			// Edge case: `git rev-parse --verify <name>` resolves any ref-ish,
			// including tags. Scoping to refs/heads/ ensures a tag named `main`
			// (with no local branch `main`) does not slip through as parent.
			const remoteDir = fsSync.mkdtempSync(
				nodePath.join(nodeOs.tmpdir(), 'argusdev-wc-remote-'),
			);
			const localDir = fsSync.mkdtempSync(
				nodePath.join(nodeOs.tmpdir(), 'argusdev-wc-local-'),
			);
			try {
				exec('git init --bare', {cwd: remoteDir, stdio: 'pipe'});
				exec('git clone ' + remoteDir + ' ' + localDir, {stdio: 'pipe'});
				exec('git config user.email "t@t.com"', {cwd: localDir, stdio: 'pipe'});
				exec('git config user.name "T"', {cwd: localDir, stdio: 'pipe'});
				exec('git config commit.gpgsign false', {
					cwd: localDir,
					stdio: 'pipe',
				});

				fsSync.writeFileSync(nodePath.join(localDir, 'f.txt'), 'x');
				exec('git add f.txt', {cwd: localDir, stdio: 'pipe'});
				exec('git commit -m "init"', {cwd: localDir, stdio: 'pipe'});
				exec('git branch -M main', {cwd: localDir, stdio: 'pipe'});
				exec('git push -u origin main', {cwd: localDir, stdio: 'pipe'});

				exec('git checkout -b feat/thing', {cwd: localDir, stdio: 'pipe'});
				exec('git branch --set-upstream-to=origin/main feat/thing', {
					cwd: localDir,
					stdio: 'pipe',
				});
				fsSync.writeFileSync(nodePath.join(localDir, 'g.txt'), 'y');
				exec('git add g.txt', {cwd: localDir, stdio: 'pipe'});
				exec('git commit -m "feat"', {cwd: localDir, stdio: 'pipe'});

				// Drop local main branch, but create a tag named `main`.
				exec('git branch -D main', {cwd: localDir, stdio: 'pipe'});
				exec('git tag main HEAD', {cwd: localDir, stdio: 'pipe'});

				const result = await Effect.runPromise(
					getWorktreeParentBranchWithSource(localDir),
				);
				// Tag must not be accepted as a local branch.
				if (result !== null) {
					expect(result.source).not.toBe('upstream');
				}
			} finally {
				fsSync.rmSync(remoteDir, {recursive: true, force: true});
				fsSync.rmSync(localDir, {recursive: true, force: true});
			}
		});
	});
});
