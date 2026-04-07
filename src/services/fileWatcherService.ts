import {watch, FSWatcher, existsSync} from 'fs';
import path from 'path';
import {logger} from '../utils/logger.js';
import {EventEmitter} from 'events';
import {getConfigDir} from '../utils/configDir.js';

export interface FileWatcherEvents {
	worktrees_changed: (projectPath: string) => void;
	projects_changed: () => void;
}

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
	private projectsWatcher: FSWatcher | null = null;
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
	private readonly debounceMs = 500;

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
			// We watch the .git directory and filter for worktrees changes
			// This handles the case where worktrees/ doesn't exist yet
			const watcher = watch(
				gitDir,
				{recursive: false, persistent: true},
				(eventType, filename) => {
					// Only care about worktrees directory changes
					if (filename === 'worktrees' || filename?.startsWith('worktrees/')) {
						this.debouncedEmit('worktrees_changed', normalizedPath);
					}
				},
			);

			watcher.on('error', error => {
				logger.warn(`[FileWatcher] Error watching ${gitDir}: ${error.message}`);
			});

			this.worktreeWatchers.set(normalizedPath, watcher);
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
			this.clearDebounceTimer(`worktrees_changed:${normalizedPath}`);
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
}

// Singleton instance
export const fileWatcherService = new FileWatcherService();
