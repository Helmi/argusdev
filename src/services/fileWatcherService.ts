import {execSync} from 'child_process';
import {watch, FSWatcher, existsSync} from 'fs';
import path from 'path';
import {logger} from '../utils/logger.js';
import {EventEmitter} from 'events';
import {getConfigDir} from '../utils/configDir.js';

export interface FileWatcherEvents {
	worktrees_changed: (projectPath: string) => void;
	git_status_changed: (projectPath: string) => void;
	projects_changed: () => void;
}

// .git/ files whose changes indicate the working tree status changed
const GIT_STATUS_FILES = new Set([
	'index', // staging area changed
	'HEAD', // commit or branch switch
	'MERGE_HEAD', // merge in progress
	'REVERT_HEAD', // revert in progress
	'CHERRY_PICK_HEAD',
]);

/**
 * FileWatcherService - Watches filesystem for external changes
 *
 * Monitors:
 * - .git/worktrees/ directory for each project (worktree add/remove via CLI)
 * - projects.json for project list changes (external edits)
 *
 * Emits debounced events that apiServer forwards to frontend via socket.io.
 */
class FileWatcherService extends EventEmitter {
	private worktreeWatchers: Map<string, FSWatcher> = new Map();
	private worktreeSnapshots: Map<string, string> = new Map();
	private projectsWatcher: FSWatcher | null = null;
	private reconciliationPoller: NodeJS.Timeout | null = null;
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
	private readonly debounceMs = 500;
	private readonly reconciliationIntervalMs = 5000;
	private readonly gitTimeoutMs = 2000;

	constructor() {
		super();
	}

	/**
	 * Start watching a project's worktrees directory.
	 * @param projectPath - The project root path
	 */
	startWatchingWorktrees(projectPath: string): void {
		// Normalize path
		const normalizedPath = path.resolve(projectPath);

		// Skip if already watching
		if (this.worktreeWatchers.has(normalizedPath)) {
			return;
		}

		// Construct path to .git/
		const gitDir = path.join(normalizedPath, '.git');

		// Check if it's a git repo with worktrees directory
		if (!existsSync(gitDir)) {
			logger.debug(
				`[FileWatcher] No .git directory at ${normalizedPath}, skipping worktree watcher`,
			);
			return;
		}

		// The worktrees directory may not exist yet (no linked worktrees)
		// Watch the parent .git directory with recursive: false, then filter
		try {
			const snapshot = this.readWorktreeSnapshot(normalizedPath);
			if (snapshot !== null) {
				this.worktreeSnapshots.set(normalizedPath, snapshot);
			}

			// We watch the .git directory and filter for worktrees changes
			// This handles the case where worktrees/ doesn't exist yet
			const watcher = watch(
				gitDir,
				{recursive: false, persistent: true},
				(eventType, filename) => {
					if (filename === 'worktrees' || filename?.startsWith('worktrees/')) {
						this.debouncedReconcileWorktrees(normalizedPath);
					}
					if (
						filename &&
						(GIT_STATUS_FILES.has(filename) || filename.startsWith('refs/'))
					) {
						this.debouncedEmit('git_status_changed', normalizedPath);
					}
				},
			);

			watcher.on('error', error => {
				logger.warn(`[FileWatcher] Error watching ${gitDir}: ${error.message}`);
			});

			this.worktreeWatchers.set(normalizedPath, watcher);
			this.startReconciliationPoller();
			logger.info(
				`[FileWatcher] Started watching worktrees for ${normalizedPath}`,
			);
		} catch (error) {
			logger.warn(
				`[FileWatcher] Failed to start worktree watcher for ${normalizedPath}: ${error}`,
			);
		}
	}

	/**
	 * Stop watching a project's worktrees directory.
	 * @param projectPath - The project root path
	 */
	stopWatchingWorktrees(projectPath: string): void {
		const normalizedPath = path.resolve(projectPath);
		const watcher = this.worktreeWatchers.get(normalizedPath);

		if (watcher) {
			watcher.close();
			this.worktreeWatchers.delete(normalizedPath);
			this.worktreeSnapshots.delete(normalizedPath);
			this.clearDebounceTimer(`worktrees_changed:${normalizedPath}`);
			this.clearDebounceTimer(`git_status_changed:${normalizedPath}`);
			this.clearDebounceTimer(`reconcile_worktrees:${normalizedPath}`);
			if (this.worktreeWatchers.size === 0) {
				this.stopReconciliationPoller();
			}
			logger.info(
				`[FileWatcher] Stopped watching worktrees for ${normalizedPath}`,
			);
		}
	}

	/**
	 * Start watching the projects.json file for changes.
	 */
	startWatchingProjects(): void {
		// Skip if already watching
		if (this.projectsWatcher) {
			return;
		}

		let configDir: string;
		try {
			configDir = getConfigDir();
		} catch (error) {
			logger.warn(
				`[FileWatcher] Config directory unavailable, skipping projects watcher: ${String(error)}`,
			);
			return;
		}
		// Watch the config directory (can't watch non-existent files directly)
		try {
			const watcher = watch(
				configDir,
				{recursive: false, persistent: true},
				(eventType, filename) => {
					if (filename === 'projects.json') {
						this.debouncedEmit('projects_changed', undefined);
					}
				},
			);

			watcher.on('error', error => {
				logger.warn(
					`[FileWatcher] Error watching ${configDir}: ${error.message}`,
				);
			});

			this.projectsWatcher = watcher;
			logger.info(`[FileWatcher] Started watching projects.json`);
		} catch (error) {
			logger.warn(`[FileWatcher] Failed to start projects watcher: ${error}`);
		}
	}

	/**
	 * Stop watching the projects.json file.
	 */
	stopWatchingProjects(): void {
		if (this.projectsWatcher) {
			this.projectsWatcher.close();
			this.projectsWatcher = null;
			this.clearDebounceTimer('projects_changed');
			logger.info(`[FileWatcher] Stopped watching projects.json`);
		}
	}

	/**
	 * Start watching all registered projects and the global projects.json.
	 * @param projectPaths - Array of project paths to watch
	 */
	startWatching(projectPaths: string[]): void {
		// Start watching projects.json
		this.startWatchingProjects();

		// Start watching each project's worktrees
		for (const projectPath of projectPaths) {
			this.startWatchingWorktrees(projectPath);
		}
	}

	/**
	 * Stop all watchers (cleanup on shutdown).
	 */
	stopAll(): void {
		// Stop projects watcher
		this.stopWatchingProjects();

		// Stop all worktree watchers
		for (const [projectPath] of this.worktreeWatchers) {
			this.stopWatchingWorktrees(projectPath);
		}
		this.stopReconciliationPoller();
		this.worktreeSnapshots.clear();

		// Clear all timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();

		logger.info('[FileWatcher] All watchers stopped');
	}

	/**
	 * Update watched projects (called when project list changes).
	 * @param newProjectPaths - New array of project paths to watch
	 */
	updateWatchedProjects(newProjectPaths: string[]): void {
		const newPathSet = new Set(newProjectPaths.map(p => path.resolve(p)));

		// Stop watching projects no longer in the list
		for (const [watchedPath] of this.worktreeWatchers) {
			if (!newPathSet.has(watchedPath)) {
				this.stopWatchingWorktrees(watchedPath);
			}
		}

		// Start watching new projects
		for (const projectPath of newProjectPaths) {
			this.startWatchingWorktrees(projectPath);
		}
	}

	/**
	 * Emit a debounced event.
	 */
	private debouncedEmit(event: string, data: string | undefined): void {
		const timerKey = data ? `${event}:${data}` : event;

		// Clear existing timer
		this.clearDebounceTimer(timerKey);

		// Set new timer
		const timer = setTimeout(() => {
			this.debounceTimers.delete(timerKey);
			if (data !== undefined) {
				this.emit(event, data);
			} else {
				this.emit(event);
			}
		}, this.debounceMs);

		this.debounceTimers.set(timerKey, timer);
	}

	/**
	 * Clear a debounce timer.
	 */
	private clearDebounceTimer(key: string): void {
		const timer = this.debounceTimers.get(key);
		if (timer) {
			clearTimeout(timer);
			this.debounceTimers.delete(key);
		}
	}

	private debouncedReconcileWorktrees(projectPath: string): void {
		const timerKey = `reconcile_worktrees:${projectPath}`;
		this.clearDebounceTimer(timerKey);

		const timer = setTimeout(() => {
			this.debounceTimers.delete(timerKey);
			this.reconcileWorktrees(projectPath);
		}, this.debounceMs);

		this.debounceTimers.set(timerKey, timer);
	}

	private startReconciliationPoller(): void {
		if (this.reconciliationPoller) {
			return;
		}

		this.reconciliationPoller = setInterval(() => {
			for (const projectPath of this.worktreeWatchers.keys()) {
				this.reconcileWorktrees(projectPath);
			}
		}, this.reconciliationIntervalMs);
	}

	private stopReconciliationPoller(): void {
		if (!this.reconciliationPoller) {
			return;
		}

		clearInterval(this.reconciliationPoller);
		this.reconciliationPoller = null;
	}

	private reconcileWorktrees(projectPath: string): void {
		const snapshot = this.readWorktreeSnapshot(projectPath);
		if (snapshot === null) {
			return;
		}

		const previous = this.worktreeSnapshots.get(projectPath);
		this.worktreeSnapshots.set(projectPath, snapshot);

		if (previous === undefined || previous === snapshot) {
			return;
		}

		this.emit('worktrees_changed', projectPath);
	}

	private readWorktreeSnapshot(projectPath: string): string | null {
		try {
			const output = execSync('git worktree list --porcelain', {
				cwd: projectPath,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
				timeout: this.gitTimeoutMs,
			});
			const paths = this.parseVisibleWorktreePaths(output);
			return paths.sort().join('\n');
		} catch (error) {
			logger.debug(
				`[FileWatcher] Failed to reconcile worktrees for ${projectPath}: ${String(error)}`,
			);
			return null;
		}
	}

	private parseVisibleWorktreePaths(output: string): string[] {
		const paths: string[] = [];
		let currentPath: string | null = null;
		let isPrunable = false;

		const flush = (): void => {
			if (!currentPath) {
				return;
			}

			const resolvedPath = path.resolve(currentPath);
			if (!isPrunable && existsSync(resolvedPath)) {
				paths.push(resolvedPath);
			}

			currentPath = null;
			isPrunable = false;
		};

		for (const rawLine of output.split('\n')) {
			const line = rawLine.replace(/\r$/, '');
			if (line.startsWith('worktree ')) {
				flush();
				currentPath = line.substring(9);
				continue;
			}

			if (line.startsWith('prunable')) {
				isPrunable = true;
			}
		}

		flush();
		return paths;
	}
}

// Singleton instance
export const fileWatcherService = new FileWatcherService();
