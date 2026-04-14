import {describe, it, expect, beforeEach, vi} from 'vitest';
import {WorktreeService} from './worktreeService.js';
import {execSync, execFileSync} from 'child_process';
import {existsSync, statSync, Stats} from 'fs';
import path from 'path';
import {configurationManager} from './configurationManager.js';
import {Effect} from 'effect';
import {GitError} from '../types/errors.js';

// Mock child_process module
vi.mock('child_process');

// Mock fs module
vi.mock('fs');

// Mock worktreeConfigManager
vi.mock('./worktreeConfigManager.js', () => ({
	worktreeConfigManager: {
		initialize: vi.fn(),
		isAvailable: vi.fn(() => true),
		reset: vi.fn(),
	},
}));

// Mock configurationManager
vi.mock('./configurationManager.js', () => ({
	configurationManager: {
		getWorktreeHooks: vi.fn(),
	},
}));

// Mock HookExecutor
vi.mock('../utils/hookExecutor.js', () => ({
	executeWorktreePostCreationHook: vi.fn(),
}));

// Get the mocked function with proper typing
const mockedExecSync = vi.mocked(execSync);
const mockedExecFileSync = vi.mocked(execFileSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedStatSync = vi.mocked(statSync);
const mockedGetWorktreeHooks = vi.mocked(configurationManager.getWorktreeHooks);

// Mock error interface for git command errors
interface MockGitError extends Error {
	status?: number;
	stderr?: string;
	stdout?: string;
}

describe('WorktreeService', () => {
	let service: WorktreeService;

	beforeEach(() => {
		vi.clearAllMocks();
		// Mock git rev-parse --git-common-dir to return a predictable path
		mockedExecSync.mockImplementation((cmd, _options) => {
			if (typeof cmd === 'string' && cmd === 'git rev-parse --git-common-dir') {
				return '/fake/path/.git\n';
			}
			throw new Error('Command not mocked: ' + cmd);
		});
		// Default mock for execFileSync - used for security-hardened git commands
		mockedExecFileSync.mockImplementation((file, args, _options) => {
			// Default: throw error (tests should mock specific commands)
			throw new Error(
				`execFileSync not mocked: ${file} ${(args as string[])?.join(' ')}`,
			);
		});
		// Default mock for getWorktreeHooks to return empty config
		mockedGetWorktreeHooks.mockReturnValue({});
		mockedExistsSync.mockReturnValue(true);
		service = new WorktreeService('/fake/path');
	});

	describe('getGitRootPath', () => {
		it('should always return an absolute path when git command returns absolute path', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (
					typeof cmd === 'string' &&
					cmd === 'git rev-parse --git-common-dir'
				) {
					return '/absolute/repo/.git\n';
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const service = new WorktreeService('/some/path');
			const result = service.getGitRootPath();

			expect(result).toBe(path.dirname('/absolute/repo/.git'));
			expect(path.isAbsolute(result)).toBe(true);
		});

		it('should convert relative path to absolute path', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (
					typeof cmd === 'string' &&
					cmd === 'git rev-parse --git-common-dir'
				) {
					return '.git\n';
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const rootPath = '/work/project';
			const service = new WorktreeService(rootPath);
			const result = service.getGitRootPath();

			// Should resolve relative .git to absolute path
			expect(result).toBe(path.resolve(rootPath));
			expect(path.isAbsolute(result)).toBe(true);
		});

		it('should handle relative paths with subdirectories', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (
					typeof cmd === 'string' &&
					cmd === 'git rev-parse --git-common-dir'
				) {
					return '../.git\n';
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const rootPath = '/work/project/subdir';
			const service = new WorktreeService(rootPath);
			const result = service.getGitRootPath();

			// Should resolve relative ../.git to absolute path
			expect(result).toBe(path.resolve('/work/project'));
			expect(path.isAbsolute(result)).toBe(true);
		});

		it('should return absolute path on git command failure', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (
					typeof cmd === 'string' &&
					cmd === 'git rev-parse --git-common-dir'
				) {
					throw new Error('Not a git repository');
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const service = new WorktreeService('relative/path');
			const result = service.getGitRootPath();

			// Should convert relative path to absolute path
			expect(result).toBe(path.resolve('relative/path'));
			expect(path.isAbsolute(result)).toBe(true);
		});

		it('should handle worktree paths correctly', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (
					typeof cmd === 'string' &&
					cmd === 'git rev-parse --git-common-dir'
				) {
					// Worktrees often return paths like: /path/to/main/.git/worktrees/feature
					return '/main/repo/.git/worktrees/feature\n';
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const service = new WorktreeService('/main/repo/feature-worktree');
			const result = service.getGitRootPath();

			// Should get the parent of .git directory
			expect(result).toBe(path.dirname('/main/repo/.git'));
			expect(path.isAbsolute(result)).toBe(true);
		});
	});

	describe('getDefaultBranchEffect', () => {
		it('should return Effect with default branch from origin', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git' && argsArray?.includes('symbolic-ref')) {
					return 'refs/remotes/origin/main\n';
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			const effect = service.getDefaultBranchEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toBe('main');
			expect(execFileSync).toHaveBeenCalledWith(
				'git',
				['symbolic-ref', 'refs/remotes/origin/HEAD'],
				expect.objectContaining({
					cwd: path.resolve('/fake/path'),
					encoding: 'utf8',
				}),
			);
		});

		it('should fallback to main if origin HEAD fails', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd.includes('rev-parse --verify main')) {
						return 'hash';
					}
				}
				throw new Error('Not found');
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git' && argsArray?.includes('symbolic-ref')) {
					throw new Error('No origin');
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			const effect = service.getDefaultBranchEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toBe('main');
		});

		it('should fallback to current HEAD branch when origin/main/master are unavailable', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (
						cmd.includes('rev-parse --verify main') ||
						cmd.includes('rev-parse --verify master')
					) {
						throw new Error('Not found');
					}
					if (cmd === 'git rev-parse --abbrev-ref HEAD') {
						return 'demo\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git' && argsArray?.includes('symbolic-ref')) {
					throw new Error('No origin');
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			const effect = service.getDefaultBranchEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toBe('demo');
		});
	});

	describe('getAllBranchesEffect', () => {
		it('should return Effect with all branches without duplicates', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git' && argsArray?.includes('branch')) {
					return `main
feature/test
origin/main
origin/feature/remote
origin/feature/test
`;
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			const effect = service.getAllBranchesEffect();
			const result = await Effect.runPromise(effect);

			// Order may vary between implementations, check content instead
			expect(result).toHaveLength(3);
			expect(result).toContain('main');
			expect(result).toContain('feature/test');
			expect(result).toContain('feature/remote');
		});

		it('should return empty array on error', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (
					typeof cmd === 'string' &&
					cmd === 'git rev-parse --git-common-dir'
				) {
					return '/fake/path/.git\n';
				}
				throw new Error('Git error');
			});
			mockedExecFileSync.mockImplementation(() => {
				throw new Error('Git error');
			});

			const effect = service.getAllBranchesEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toEqual([]);
		});
	});

	describe('getCurrentBranchEffect', () => {
		it('should return Effect with current branch name on success', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git rev-parse --abbrev-ref HEAD') {
						return 'feature-branch\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.getCurrentBranchEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toBe('feature-branch');
			expect(execSync).toHaveBeenCalledWith(
				'git rev-parse --abbrev-ref HEAD',
				expect.objectContaining({
					cwd: path.resolve('/fake/path'),
					encoding: 'utf8',
				}),
			);
		});

		it('should return Effect with "unknown" when git command fails', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git rev-parse --abbrev-ref HEAD') {
						throw new Error('fatal: not a git repository');
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.getCurrentBranchEffect();
			const result = await Effect.runPromise(effect);

			// Should fallback to 'unknown' instead of failing
			expect(result).toBe('unknown');
		});

		it('should return Effect with "unknown" when branch name is empty', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git rev-parse --abbrev-ref HEAD') {
						return '\n'; // Empty branch name
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.getCurrentBranchEffect();
			const result = await Effect.runPromise(effect);

			// Should fallback to 'unknown' when no branch returned
			expect(result).toBe('unknown');
		});
	});

	describe('resolveBranchReference', () => {
		it('should return local branch when it exists', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				// Local branch check - succeeds (branch exists)
				if (
					file === 'git' &&
					argsArray?.includes('show-ref') &&
					argsArray?.includes('refs/heads/foo/bar-xyz')
				) {
					return ''; // Local branch exists
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (service as any).resolveBranchReference('foo/bar-xyz');
			expect(result).toBe('foo/bar-xyz');
		});

		it('should return single remote branch when local does not exist', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git remote') {
						return 'origin\nupstream\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git' && argsArray?.includes('show-ref')) {
					// Local branch check - fails
					if (argsArray?.includes('refs/heads/foo/bar-xyz')) {
						throw new Error('Local branch not found');
					}
					// Remote origin check - succeeds
					if (argsArray?.includes('refs/remotes/origin/foo/bar-xyz')) {
						return '';
					}
					// Remote upstream check - fails
					if (argsArray?.includes('refs/remotes/upstream/foo/bar-xyz')) {
						throw new Error('Remote branch not found in upstream');
					}
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (service as any).resolveBranchReference('foo/bar-xyz');
			expect(result).toBe('origin/foo/bar-xyz');
		});

		it('should throw AmbiguousBranchError when multiple remotes have the branch', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git remote') {
						return 'origin\nupstream\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git' && argsArray?.includes('show-ref')) {
					// Local branch check - fails
					if (argsArray?.includes('refs/heads/foo/bar-xyz')) {
						throw new Error('Local branch not found');
					}
					// Both remotes have the branch
					if (
						argsArray?.includes('refs/remotes/origin/foo/bar-xyz') ||
						argsArray?.includes('refs/remotes/upstream/foo/bar-xyz')
					) {
						return '';
					}
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			expect(() => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(service as any).resolveBranchReference('foo/bar-xyz');
			}).toThrow(
				"Ambiguous branch 'foo/bar-xyz' found in multiple remotes: origin/foo/bar-xyz, upstream/foo/bar-xyz. Please specify which remote to use.",
			);
		});

		it('should return original branch name when no branches exist', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git remote') {
						return 'origin\n';
					}
				}
				throw new Error('Branch not found');
			});
			mockedExecFileSync.mockImplementation(() => {
				throw new Error('Branch not found');
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (service as any).resolveBranchReference(
				'nonexistent-branch',
			);
			expect(result).toBe('nonexistent-branch');
		});

		it('should handle no remotes gracefully', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git remote') {
						return ''; // No remotes
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation(() => {
				throw new Error('Local branch not found');
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (service as any).resolveBranchReference('some-branch');
			expect(result).toBe('some-branch');
		});

		it('should prefer local branch over remote branches', () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (
					file === 'git' &&
					argsArray?.includes('show-ref') &&
					argsArray?.includes('refs/heads/foo/bar-xyz')
				) {
					return ''; // Local branch exists
				}
				// Remote commands should not be called when local exists
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = (service as any).resolveBranchReference('foo/bar-xyz');
			expect(result).toBe('foo/bar-xyz');
		});
	});

	describe('hasClaudeDirectoryInBranchEffect', () => {
		it('should return Effect with true when .claude directory exists in branch worktree', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/feature-branch
HEAD efgh5678
branch refs/heads/feature-branch
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			mockedExistsSync.mockImplementation(p => {
				const normalizedPath = String(p);
				return (
					normalizedPath === '/fake/path' ||
					normalizedPath === '/fake/path/feature-branch' ||
					normalizedPath === path.join('/fake/path/feature-branch', '.claude')
				);
			});

			mockedStatSync.mockImplementation(
				() =>
					({
						isDirectory: () => true,
					}) as Stats,
			);

			const effect = service.hasClaudeDirectoryInBranchEffect('feature-branch');
			const result = await Effect.runPromise(effect);

			expect(result).toBe(true);
			expect(existsSync).toHaveBeenCalledWith(
				path.join('/fake/path/feature-branch', '.claude'),
			);
			expect(statSync).toHaveBeenCalledWith(
				path.join('/fake/path/feature-branch', '.claude'),
			);
		});

		it('should return Effect with false when .claude directory does not exist', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/feature-branch
HEAD efgh5678
branch refs/heads/feature-branch
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			mockedExistsSync.mockImplementation(
				worktreePath =>
					String(worktreePath) === '/fake/path' ||
					String(worktreePath) === '/fake/path/feature-branch',
			);

			const effect = service.hasClaudeDirectoryInBranchEffect('feature-branch');
			const result = await Effect.runPromise(effect);

			expect(result).toBe(false);
			expect(existsSync).toHaveBeenCalledWith(
				path.join('/fake/path/feature-branch', '.claude'),
			);
		});

		it('should return Effect with false when .claude exists but is not a directory', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/feature-branch
HEAD efgh5678
branch refs/heads/feature-branch
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			mockedExistsSync.mockReturnValue(true);
			mockedStatSync.mockImplementation(
				() =>
					({
						isDirectory: () => false,
					}) as Stats,
			);

			const effect = service.hasClaudeDirectoryInBranchEffect('feature-branch');
			const result = await Effect.runPromise(effect);

			expect(result).toBe(false);
		});

		it('should fallback to default branch when branch worktree not found', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main
`;
					}
					if (cmd.includes('symbolic-ref')) {
						return 'main\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			mockedExistsSync.mockReturnValue(true);
			mockedStatSync.mockImplementation(
				() =>
					({
						isDirectory: () => true,
					}) as Stats,
			);

			// When asking for main branch that doesn't have a separate worktree
			const effect = service.hasClaudeDirectoryInBranchEffect('main');
			const result = await Effect.runPromise(effect);

			expect(result).toBe(true);
			expect(existsSync).toHaveBeenCalledWith(
				path.join('/fake/path', '.claude'),
			);
		});

		it('should return Effect with false when branch not found in any worktree', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main
`;
					}
					if (cmd.includes('symbolic-ref')) {
						return 'main\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.hasClaudeDirectoryInBranchEffect(
				'non-existent-branch',
			);
			const result = await Effect.runPromise(effect);

			expect(result).toBe(false);
		});

		it('should check main worktree when branch is default branch', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/other-branch
HEAD efgh5678
branch refs/heads/other-branch
`;
					}
					if (cmd.includes('symbolic-ref')) {
						return 'main\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			mockedExistsSync.mockReturnValue(true);
			mockedStatSync.mockImplementation(
				() =>
					({
						isDirectory: () => true,
					}) as Stats,
			);

			const effect = service.hasClaudeDirectoryInBranchEffect('main');
			const result = await Effect.runPromise(effect);

			expect(result).toBe(true);
			expect(existsSync).toHaveBeenCalledWith(
				path.join('/fake/path', '.claude'),
			);
		});
	});

	describe('Effect-based getWorktrees', () => {
		it('should return Effect with worktree array on success', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/feature
HEAD efgh5678
branch refs/heads/feature
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.getWorktreesEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				path: '/fake/path',
				branch: 'main',
				isMainWorktree: true,
			});
			expect(result[1]).toMatchObject({
				path: '/fake/path/feature',
				branch: 'feature',
				isMainWorktree: false,
			});
		});

		it('should mark repository root worktree as main when output order is non-root first', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path/demo
HEAD abcd1234
branch refs/heads/demo

worktree /fake/path
HEAD efgh5678
branch refs/heads/main
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.getWorktreesEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toHaveLength(2);
			expect(result[0]).toMatchObject({
				path: '/fake/path/demo',
				branch: 'demo',
				isMainWorktree: false,
			});
			expect(result[1]).toMatchObject({
				path: '/fake/path',
				branch: 'main',
				isMainWorktree: true,
			});
		});

		it('should skip prunable worktrees from the visible list', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/feature
HEAD efgh5678
branch refs/heads/feature
prunable gitdir file points to non-existent location
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.getWorktreesEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				path: '/fake/path',
				branch: 'main',
				isMainWorktree: true,
			});
		});

		it('should skip missing worktree directories from the visible list', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/feature
HEAD efgh5678
branch refs/heads/feature
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExistsSync.mockImplementation(
				worktreePath => String(worktreePath) !== '/fake/path/feature',
			);

			const effect = service.getWorktreesEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				path: '/fake/path',
				branch: 'main',
				isMainWorktree: true,
			});
		});

		it('should return Effect that fails with GitError when git command fails', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						const error: MockGitError = new Error(
							'fatal: not a git repository',
						);
						error.status = 128;
						error.stderr = 'fatal: not a git repository';
						throw error;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.getWorktreesEffect();
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				expect(result.left).toBeInstanceOf(GitError);
				expect(result.left.command).toBe('git worktree list --porcelain');
				expect(result.left.exitCode).toBe(128);
				expect(result.left.stderr).toContain('not a git repository');
			} else {
				expect.fail('Should have returned Left with GitError');
			}
		});

		it('should fallback to single worktree when git worktree command not supported', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						const error: MockGitError = new Error('unknown command: worktree');
						error.status = 1;
						error.stderr = 'unknown command: worktree';
						throw error;
					}
					if (cmd === 'git rev-parse --abbrev-ref HEAD') {
						return 'main\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.getWorktreesEffect();
			const result = await Effect.runPromise(effect);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				path: path.resolve('/fake/path'),
				branch: 'main',
				isMainWorktree: true,
			});
		});
	});

	describe('Effect-based createWorktree', () => {
		it('should return Effect with Worktree on success', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
				}
				return '';
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git') {
					// Branch check - branch doesn't exist
					if (
						argsArray?.includes('rev-parse') &&
						argsArray?.includes('--verify')
					) {
						throw new Error('Branch not found');
					}
					// Worktree add
					if (argsArray?.includes('worktree') && argsArray?.includes('add')) {
						return '';
					}
					// Show-ref for local branch check
					if (argsArray?.includes('show-ref')) {
						throw new Error('Branch not found');
					}
				}
				return '';
			});

			const effect = service.createWorktreeEffect(
				'/path/to/worktree',
				'new-feature',
				'main',
			);
			const result = await Effect.runPromise(effect);

			expect(result).toMatchObject({
				path: '/path/to/worktree',
				branch: 'new-feature',
				isMainWorktree: false,
			});
		});

		it('should return Effect that fails with GitError on git command failure', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git') {
					// Branch check - branch doesn't exist
					if (
						argsArray?.includes('rev-parse') &&
						argsArray?.includes('--verify')
					) {
						throw new Error('Branch not found');
					}
					// Worktree add - fails
					if (argsArray?.includes('worktree') && argsArray?.includes('add')) {
						const error: MockGitError = new Error(
							'fatal: invalid reference: main',
						);
						error.status = 128;
						error.stderr = 'fatal: invalid reference: main';
						throw error;
					}
					// Show-ref for local branch check
					if (argsArray?.includes('show-ref')) {
						throw new Error('Branch not found');
					}
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			const effect = service.createWorktreeEffect(
				'/path/to/worktree',
				'new-feature',
				'main',
			);
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				expect(result.left).toBeInstanceOf(GitError);
				expect((result.left as GitError).exitCode).toBe(128);
				expect((result.left as GitError).stderr).toContain('invalid reference');
			} else {
				expect.fail('Should have returned Left with GitError');
			}
		});
	});

	describe('Effect-based deleteWorktree', () => {
		it('should return Effect with void on success', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/feature
HEAD efgh5678
branch refs/heads/feature
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git') {
					// Worktree remove
					if (
						argsArray?.includes('worktree') &&
						argsArray?.includes('remove')
					) {
						return '';
					}
					// Branch delete
					if (argsArray?.includes('branch') && argsArray?.includes('-D')) {
						return '';
					}
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			const effect = service.deleteWorktreeEffect('/fake/path/feature');
			await Effect.runPromise(effect);

			expect(execFileSync).toHaveBeenCalledWith(
				'git',
				expect.arrayContaining(['worktree', 'remove']),
				expect.any(Object),
			);
		});

		it('should return Effect that fails with GitError when worktree not found', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.deleteWorktreeEffect('/fake/path/nonexistent');
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				expect(result.left).toBeInstanceOf(GitError);
				expect(result.left.stderr).toContain('Worktree not found');
			} else {
				expect.fail('Should have returned Left with GitError');
			}
		});

		it('should return Effect that fails with GitError when trying to delete main worktree', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.deleteWorktreeEffect('/fake/path');
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				expect(result.left).toBeInstanceOf(GitError);
				expect(result.left.stderr).toContain('Cannot delete the main worktree');
			} else {
				expect.fail('Should have returned Left with GitError');
			}
		});
	});

	describe('Effect-based mergeWorktree', () => {
		it('should return Effect with void on successful merge', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/feature
HEAD efgh5678
branch refs/heads/feature
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git') {
					// Merge command
					if (argsArray?.includes('merge')) {
						return 'Merge successful';
					}
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			const effect = service.mergeWorktreeEffect('feature', 'main', false);
			await Effect.runPromise(effect);

			expect(execFileSync).toHaveBeenCalledWith(
				'git',
				expect.arrayContaining(['merge', '--no-ff']),
				expect.any(Object),
			);
		});

		it('should return Effect that fails with GitError when target branch not found', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});

			const effect = service.mergeWorktreeEffect(
				'feature',
				'nonexistent',
				false,
			);
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				expect(result.left).toBeInstanceOf(GitError);
				expect(result.left.stderr).toContain(
					'Target branch worktree not found',
				);
			} else {
				expect.fail('Should have returned Left with GitError');
			}
		});

		it('should return Effect that fails with GitError on merge conflict', async () => {
			mockedExecSync.mockImplementation((cmd, _options) => {
				if (typeof cmd === 'string') {
					if (cmd === 'git rev-parse --git-common-dir') {
						return '/fake/path/.git\n';
					}
					if (cmd === 'git worktree list --porcelain') {
						return `worktree /fake/path
HEAD abcd1234
branch refs/heads/main

worktree /fake/path/feature
HEAD efgh5678
branch refs/heads/feature
`;
					}
				}
				throw new Error('Command not mocked: ' + cmd);
			});
			mockedExecFileSync.mockImplementation((file, args, _options) => {
				const argsArray = args as string[];
				if (file === 'git') {
					// Merge command - fails with conflict
					if (argsArray?.includes('merge')) {
						const error: MockGitError = new Error('CONFLICT: Merge conflict');
						error.status = 1;
						error.stderr = 'CONFLICT: Merge conflict in file.txt';
						throw error;
					}
				}
				throw new Error(
					`execFileSync not mocked: ${file} ${argsArray?.join(' ')}`,
				);
			});

			const effect = service.mergeWorktreeEffect('feature', 'main', false);
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				expect(result.left).toBeInstanceOf(GitError);
				expect(result.left.exitCode).toBe(1);
				expect(result.left.stderr).toContain('Merge conflict');
			} else {
				expect.fail('Should have returned Left with GitError');
			}
		});
	});
});
