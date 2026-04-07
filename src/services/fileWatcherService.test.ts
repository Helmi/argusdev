import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {fileWatcherService} from './fileWatcherService.js';
import * as fs from 'fs';
import path from 'path';

// Mock fs module
vi.mock('fs', () => ({
	watch: vi.fn(() => ({
		on: vi.fn(),
		close: vi.fn(),
	})),
	existsSync: vi.fn((filePath: string) => {
		// Return false for /non-git test path to simulate non-git directory
		if (filePath.includes('/non-git')) {
			return false;
		}
		// Return true for other .git directories
		return filePath.endsWith('.git');
	}),
}));

// Mock configDir
vi.mock('../utils/configDir.js', () => ({
	getConfigDir: () => '/test/config',
}));

describe('FileWatcherService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fileWatcherService.stopAll();
		fileWatcherService.removeAllListeners();
	});

	afterEach(() => {
		fileWatcherService.stopAll();
		fileWatcherService.removeAllListeners();
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
	});
});
