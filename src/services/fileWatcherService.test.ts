import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {fileWatcherService} from './fileWatcherService.js';
import {execSync} from 'child_process';
import * as fs from 'fs';
import path from 'path';

vi.mock('child_process', () => ({
	execSync: vi.fn(
		() => `worktree /test/project
HEAD abc123
branch refs/heads/main
`,
	),
}));

// Mock fs module
vi.mock('fs', () => ({
	watch: vi.fn(() => ({
		on: vi.fn(),
		close: vi.fn(),
	})),
	existsSync: vi.fn((filePath: string) => {
		if (filePath.includes('/non-git')) {
			return false;
		}
		return true;
	}),
}));

// Mock configDir
vi.mock('../utils/configDir.js', () => ({
	getConfigDir: () => '/test/config',
}));

describe('FileWatcherService', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		vi.mocked(execSync).mockImplementation(
			() => `worktree /test/project
HEAD abc123
branch refs/heads/main
`,
		);
		vi.mocked(fs.existsSync).mockImplementation((filePath: string) => {
			if (filePath.includes('/non-git')) {
				return false;
			}
			return true;
		});
		fileWatcherService.stopAll();
		fileWatcherService.removeAllListeners();
	});

	afterEach(() => {
		fileWatcherService.stopAll();
		fileWatcherService.removeAllListeners();
		vi.useRealTimers();
	});

	describe('startWatchingWorktrees', () => {
		it('should start watching a project worktrees directory', () => {
			const projectPath = '/test/project';
			fileWatcherService.startWatchingWorktrees(projectPath);

			expect(fs.existsSync).toHaveBeenCalledWith(
				path.join(projectPath, '.git'),
			);
			expect(fs.watch).toHaveBeenCalledTimes(1);
		});

		it('should not start duplicate watchers for same path', () => {
			const projectPath = '/test/project';
			fileWatcherService.startWatchingWorktrees(projectPath);
			fileWatcherService.startWatchingWorktrees(projectPath);

			expect(fs.watch).toHaveBeenCalledTimes(1);
		});

		it('should skip non-git directories', () => {
			const projectPath = '/test/non-git';
			fileWatcherService.startWatchingWorktrees(projectPath);

			expect(fs.watch).not.toHaveBeenCalled();
		});
	});

	describe('stopWatchingWorktrees', () => {
		it('should stop watching a project', () => {
			const projectPath = '/test/project';
			fileWatcherService.startWatchingWorktrees(projectPath);
			fileWatcherService.stopWatchingWorktrees(projectPath);

			fileWatcherService.stopWatchingWorktrees('/test/other');
		});

		it('should clear the reconciliation poller when the last project stops watching', () => {
			fileWatcherService.startWatchingWorktrees('/test/project');
			fileWatcherService.stopWatchingWorktrees('/test/project');

			expect(
				(
					fileWatcherService as unknown as {
						reconciliationPoller: NodeJS.Timeout | null;
					}
				).reconciliationPoller,
			).toBeNull();
		});
	});

	describe('startWatchingProjects', () => {
		it('should start watching projects.json', () => {
			fileWatcherService.startWatchingProjects();

			expect(fs.watch).toHaveBeenCalledWith(
				'/test/config',
				expect.objectContaining({recursive: false, persistent: true}),
				expect.any(Function),
			);
		});

		it('should not start duplicate projects watcher', () => {
			fileWatcherService.startWatchingProjects();
			fileWatcherService.startWatchingProjects();

			expect(fs.watch).toHaveBeenCalledTimes(1);
		});
	});

	describe('startWatching', () => {
		it('should start watching multiple projects and projects.json', () => {
			const projectPaths = ['/test/project1', '/test/project2'];
			fileWatcherService.startWatching(projectPaths);

			expect(fs.watch).toHaveBeenCalledTimes(3);
		});
	});

	describe('stopAll', () => {
		it('should stop all watchers', () => {
			const projectPaths = ['/test/project1', '/test/project2'];
			fileWatcherService.startWatching(projectPaths);
			fileWatcherService.stopAll();

			fileWatcherService.stopAll();
		});
	});

	describe('updateWatchedProjects', () => {
		it('should add new project watchers', () => {
			// Start initial project
			fileWatcherService.startWatching(['/test/project1']);
			// Clear mock count (keeps projects.json watcher already set up)
			vi.mocked(fs.watch).mockClear();

			fileWatcherService.updateWatchedProjects([
				'/test/project1',
				'/test/project2',
			]);

			// Should add watcher for new project
			expect(fs.watch).toHaveBeenCalledTimes(1);
		});
	});

	describe('events', () => {
		it('should emit worktrees_changed event', () => {
			const listener = vi.fn();
			fileWatcherService.on('worktrees_changed', listener);

			fileWatcherService.emit('worktrees_changed', '/test/project');

			expect(listener).toHaveBeenCalledWith('/test/project');
		});

		it('should emit projects_changed event', () => {
			const listener = vi.fn();
			fileWatcherService.on('projects_changed', listener);

			fileWatcherService.emit('projects_changed');

			expect(listener).toHaveBeenCalled();
		});

		it('should reconcile watcher events against git worktree state', () => {
			const listener = vi.fn();
			const projectPath = '/test/project';

			vi.mocked(execSync).mockReturnValueOnce(`worktree /test/project
HEAD abc123
branch refs/heads/main

worktree /test/project-feature
HEAD def456
branch refs/heads/feature
`).mockReturnValueOnce(`worktree /test/project
HEAD abc123
branch refs/heads/main
`);

			fileWatcherService.on('worktrees_changed', listener);
			fileWatcherService.startWatchingWorktrees(projectPath);

			const callback = vi.mocked(fs.watch).mock.calls[0]?.[2] as
				| ((eventType: string, filename?: string) => void)
				| undefined;
			callback?.('rename', 'worktrees');
			vi.advanceTimersByTime(500);

			expect(listener).toHaveBeenCalledWith(projectPath);
			expect(execSync).toHaveBeenLastCalledWith(
				'git worktree list --porcelain',
				expect.objectContaining({
					cwd: projectPath,
					timeout: 2000,
				}),
			);
		});

		it('should detect external deletions during reconciliation polling', () => {
			const listener = vi.fn();
			const projectPath = '/test/project';

			vi.mocked(execSync).mockReturnValueOnce(`worktree /test/project
HEAD abc123
branch refs/heads/main

worktree /test/project-feature
HEAD def456
branch refs/heads/feature
`).mockReturnValueOnce(`worktree /test/project
HEAD abc123
branch refs/heads/main
`);

			fileWatcherService.on('worktrees_changed', listener);
			fileWatcherService.startWatchingWorktrees(projectPath);

			vi.advanceTimersByTime(5000);

			expect(listener).toHaveBeenCalledWith(projectPath);
		});

		it('should drop missing worktree paths during reconciliation polling', () => {
			const listener = vi.fn();
			const projectPath = '/test/project';
			let featurePathExists = true;

			vi.mocked(execSync).mockReturnValueOnce(`worktree /test/project
HEAD abc123
branch refs/heads/main

worktree /test/project-feature
HEAD def456
branch refs/heads/feature
`).mockReturnValueOnce(`worktree /test/project
HEAD abc123
branch refs/heads/main

worktree /test/project-feature
HEAD def456
branch refs/heads/feature
`);
			vi.mocked(fs.existsSync).mockImplementation((filePath: string) => {
				const normalizedPath = String(filePath);
				if (normalizedPath === '/test/project-feature') {
					return featurePathExists;
				}
				if (normalizedPath.includes('/non-git')) {
					return false;
				}
				return true;
			});

			fileWatcherService.on('worktrees_changed', listener);
			fileWatcherService.startWatchingWorktrees(projectPath);

			featurePathExists = false;
			vi.advanceTimersByTime(5000);

			expect(listener).toHaveBeenCalledWith(projectPath);
		});

		it('should not emit duplicate worktree updates when watcher and poll agree', () => {
			const listener = vi.fn();
			const projectPath = '/test/project';

			vi.mocked(execSync).mockReturnValueOnce(`worktree /test/project
HEAD abc123
branch refs/heads/main

worktree /test/project-feature
HEAD def456
branch refs/heads/feature
`).mockReturnValueOnce(`worktree /test/project
HEAD abc123
branch refs/heads/main
`).mockReturnValue(`worktree /test/project
HEAD abc123
branch refs/heads/main
`);

			fileWatcherService.on('worktrees_changed', listener);
			fileWatcherService.startWatchingWorktrees(projectPath);

			const callback = vi.mocked(fs.watch).mock.calls[0]?.[2] as
				| ((eventType: string, filename?: string) => void)
				| undefined;
			callback?.('rename', 'worktrees');
			vi.advanceTimersByTime(500);
			vi.advanceTimersByTime(5000);

			expect(listener).toHaveBeenCalledTimes(1);
		});

		it('should normalize CRLF worktree output before checking path existence', () => {
			const listener = vi.fn();
			const projectPath = '/test/project';

			vi.mocked(execSync).mockReturnValueOnce(`worktree /test/project\r
HEAD abc123\r
branch refs/heads/main\r
\r
worktree /test/project-feature\r
HEAD def456\r
branch refs/heads/feature\r
`).mockReturnValueOnce(`worktree /test/project\r
HEAD abc123\r
branch refs/heads/main\r
`);

			fileWatcherService.on('worktrees_changed', listener);
			fileWatcherService.startWatchingWorktrees(projectPath);
			vi.advanceTimersByTime(5000);

			expect(fs.existsSync).toHaveBeenCalledWith('/test/project-feature');
			expect(listener).toHaveBeenCalledWith(projectPath);
		});

		it('should ignore git reconciliation failures without crashing the poller', () => {
			const listener = vi.fn();
			const projectPath = '/test/project';

			vi.mocked(execSync)
				.mockReturnValueOnce(
					`worktree /test/project
HEAD abc123
branch refs/heads/main
`,
				)
				.mockImplementationOnce(() => {
					throw new Error('git failed');
				});

			fileWatcherService.on('worktrees_changed', listener);
			fileWatcherService.startWatchingWorktrees(projectPath);

			expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
			expect(listener).not.toHaveBeenCalled();
		});

		it('should reconcile all watched projects during one poll tick', () => {
			const listener = vi.fn();

			vi.mocked(execSync).mockReturnValueOnce(`worktree /test/project-a
HEAD abc123
branch refs/heads/main

worktree /test/project-a-feature
HEAD def456
branch refs/heads/feature
`).mockReturnValueOnce(`worktree /test/project-b
HEAD abc123
branch refs/heads/main

worktree /test/project-b-feature
HEAD def456
branch refs/heads/feature
`).mockReturnValueOnce(`worktree /test/project-a
HEAD abc123
branch refs/heads/main
`).mockReturnValueOnce(`worktree /test/project-b
HEAD abc123
branch refs/heads/main
`);

			fileWatcherService.on('worktrees_changed', listener);
			fileWatcherService.startWatching(['/test/project-a', '/test/project-b']);

			vi.advanceTimersByTime(5000);

			expect(listener).toHaveBeenCalledTimes(2);
			expect(listener).toHaveBeenCalledWith('/test/project-a');
			expect(listener).toHaveBeenCalledWith('/test/project-b');
		});
	});
});
