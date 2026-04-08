import {execFileSync} from 'child_process';
import {existsSync, statSync, readFileSync} from 'fs';
import {readFile} from 'fs/promises';
import path from 'path';
import {logger} from '../utils/logger.js';

export interface TdAvailability {
	/** td binary found in PATH */
	binaryAvailable: boolean;
	/** Version string from td --version, null if not found */
	version: string | null;
	/** Path to td binary */
	binaryPath: string | null;
}

export interface TdProjectState {
	/** Whether td is available for this project */
	enabled: boolean;
	/** Whether the project has a valid .todos/ state */
	initialized: boolean;
	/** Whether td binary is available on this machine */
	binaryAvailable: boolean;
	/** Path to .todos/ directory (resolved from .td-root or direct) */
	todosDir: string | null;
	/** Path to the issues.db SQLite database */
	dbPath: string | null;
	/** The project root that .td-root points to (may differ from worktree path) */
	tdRoot: string | null;
}

/**
 * TdService — Optional td task management integration.
 *
 * Detects td availability and resolves project-level td state.
 * All methods gracefully return disabled/null when td is not present.
 * This service is the gatekeeper: if tdAvailability.binaryAvailable is false,
 * no other td functionality should activate.
 */
class TdService {
	private static instance: TdService;
	private availability: TdAvailability | null = null;

	private constructor() {}

	static getInstance(): TdService {
		if (!TdService.instance) {
			TdService.instance = new TdService();
		}
		return TdService.instance;
	}

	/**
	 * Check if the td binary is available on the system.
	 * Result is cached after first call.
	 */
	checkAvailability(): TdAvailability {
		if (this.availability) return this.availability;

		this.availability = {
			binaryAvailable: false,
			version: null,
			binaryPath: null,
		};

		try {
			// Use `which` on unix, `where` on windows to find the binary
			const whichCmd = process.platform === 'win32' ? 'where' : 'which';
			const binaryPath = execFileSync(whichCmd, ['td'], {
				encoding: 'utf-8',
				timeout: 5000,
			})
				.trim()
				.split('\n')[0]!;

			if (binaryPath) {
				this.availability.binaryPath = binaryPath;
				this.availability.binaryAvailable = true;

				// Try to get version
				try {
					const version = execFileSync('td', ['--version'], {
						encoding: 'utf-8',
						timeout: 5000,
					}).trim();
					this.availability.version = version;
				} catch {
					// Binary exists but --version failed, still usable
					this.availability.version = 'unknown';
				}

				logger.info(
					`[TdService] td binary found: ${binaryPath} (${this.availability.version})`,
				);
			}
		} catch {
			logger.info('[TdService] td binary not found in PATH');
		}

		return this.availability;
	}

	/**
	 * Check if td binary is available (convenience method).
	 */
	isAvailable(): boolean {
		return this.checkAvailability().binaryAvailable;
	}

	/**
	 * Resolve td state for a project path.
	 *
	 * Resolution order:
	 * 1. Check for .td-root file in the given path → read target root
	 * 2. Check for .todos/ directory in the given path directly
	 * 3. Walk up parent directories looking for .todos/
	 *
	 * This handles both main worktrees and linked worktrees that have .td-root
	 * pointing back to the main project.
	 */
	resolveProjectState(projectPath: string): TdProjectState {
		const binaryAvailable = this.isAvailable();
		const disabled: TdProjectState = {
			enabled: false,
			initialized: false,
			binaryAvailable,
			todosDir: null,
			dbPath: null,
			tdRoot: null,
		};

		const resolved = path.resolve(projectPath);

		// 1. Check for .td-root file — its presence means td init was run,
		//    even if .todos/issues.db doesn't exist yet (created on first ticket)
		const tdRootFile = path.join(resolved, '.td-root');
		if (existsSync(tdRootFile)) {
			try {
				const tdRootContent = readFileSync(tdRootFile, 'utf-8').trim();
				if (tdRootContent) {
					const tdRoot = path.resolve(resolved, tdRootContent);
					const tdRootResult = this.checkTodosDir(tdRoot, binaryAvailable);
					if (tdRootResult.initialized) return tdRootResult;
					// .td-root exists but .todos/issues.db not yet created —
					// still treat as enabled (initialized but no tickets yet)
					return {
						enabled: binaryAvailable,
						initialized: true,
						binaryAvailable,
						todosDir: path.join(tdRoot, '.todos'),
						dbPath: null,
						tdRoot,
					};
				}
			} catch {
				logger.warn(`[TdService] Failed to read .td-root at ${tdRootFile}`);
			}
		}

		// 2. Check for .todos/ in the given path
		const directResult = this.checkTodosDir(resolved, binaryAvailable);
		if (directResult.initialized) return directResult;

		// 3. Walk up to find .todos/ (max 10 levels, stop at git boundaries)
		let current = path.dirname(resolved);
		for (let i = 0; i < 10; i++) {
			const parentResult = this.checkTodosDir(current, binaryAvailable);
			if (parentResult.initialized) return parentResult;

			// Stop at git repository boundaries to prevent cross-project leaks
			// (e.g., a demo project inheriting .todos/ from an unrelated parent)
			if (existsSync(path.join(current, '.git'))) break;

			const parent = path.dirname(current);
			if (parent === current) break; // reached filesystem root
			current = parent;
		}

		return disabled;
	}

	/**
	 * Read .td-root file content asynchronously.
	 * Returns the resolved root path, or null if not found.
	 */
	async readTdRoot(worktreePath: string): Promise<string | null> {
		const tdRootFile = path.join(worktreePath, '.td-root');
		try {
			const content = await readFile(tdRootFile, 'utf-8');
			const trimmed = content.trim();
			if (trimmed) {
				return path.resolve(worktreePath, trimmed);
			}
		} catch {
			// File doesn't exist or can't be read
		}
		return null;
	}

	/**
	 * Reset cached availability (useful when td is installed during runtime).
	 */
	resetCache(): void {
		this.availability = null;
	}

	private checkTodosDir(
		rootPath: string,
		binaryAvailable: boolean,
	): TdProjectState {
		const todosDir = path.join(rootPath, '.todos');
		const dbPath = path.join(todosDir, 'issues.db');

		if (existsSync(todosDir) && existsSync(dbPath)) {
			try {
				const stats = statSync(dbPath);
				if (stats.isFile() && stats.size > 0) {
					return {
						enabled: binaryAvailable,
						initialized: true,
						binaryAvailable,
						todosDir,
						dbPath,
						tdRoot: rootPath,
					};
				}
			} catch {
				// stat failed, treat as not available
			}
		}

		return {
			enabled: false,
			initialized: false,
			binaryAvailable,
			todosDir: null,
			dbPath: null,
			tdRoot: null,
		};
	}
}

export const tdService = TdService.getInstance();
