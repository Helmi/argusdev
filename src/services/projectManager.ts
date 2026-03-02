import {
	GitProject,
	IProjectManager,
	IWorktreeService,
	Project,
} from '../types/index.js';
import {WorktreeService} from './worktreeService.js';
import {promises as fs} from 'fs';
import path from 'path';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import os from 'os';
import {Effect} from 'effect';
import {FileSystemError, ConfigError} from '../types/errors.js';
import {getConfigDir} from '../utils/configDir.js';

/**
 * Expand ~ to home directory in path
 */
function expandTilde(filePath: string): string {
	return filePath.startsWith('~')
		? filePath.replace(/^~/, os.homedir())
		: filePath;
}

/**
 * ProjectManager - Registry-based project management
 *
 * Projects are explicitly added by users (no auto-discovery).
 * Stores project list in projects.json, migrates from recent-projects.json on first run.
 */
export class ProjectManager implements IProjectManager {
	currentProject?: GitProject;

	private worktreeServiceCache: Map<string, IWorktreeService> = new Map();

	// Project registry
	private projects: Project[] = [];
	private dataPath: string;
	private legacyDataPath: string;
	private configDir: string;

	constructor() {
		// Initialize using shared config dir
		this.configDir = getConfigDir();

		// Ensure config directory exists
		if (!existsSync(this.configDir)) {
			mkdirSync(this.configDir, {recursive: true});
		}

		this.dataPath = path.join(this.configDir, 'projects.json');
		this.legacyDataPath = path.join(this.configDir, 'recent-projects.json');
		this.loadProjects();
	}

	selectProject(project: GitProject): void {
		this.currentProject = project;
		// Update lastAccessed for this project
		const idx = this.projects.findIndex(p => p.path === project.path);
		if (idx !== -1) {
			this.projects[idx]!.lastAccessed = Date.now();
			this.saveProjects();
		}
	}

	getWorktreeService(projectPath?: string): IWorktreeService {
		// Use provided path or fall back to current project path or current directory
		const targetPath =
			projectPath || this.currentProject?.path || process.cwd();

		// Check cache first
		if (this.worktreeServiceCache.has(targetPath)) {
			return this.worktreeServiceCache.get(targetPath)!;
		}

		// Create new service and cache it
		const service = new WorktreeService(targetPath);
		this.worktreeServiceCache.set(targetPath, service);
		return service;
	}

	getCurrentProjectPath(): string {
		return this.currentProject?.path || process.cwd();
	}

	// Clear cache for a specific project
	clearWorktreeServiceCache(projectPath?: string): void {
		if (projectPath) {
			this.worktreeServiceCache.delete(projectPath);
		} else {
			this.worktreeServiceCache.clear();
		}
	}

	// Get all cached WorktreeService instances (useful for cleanup)
	getCachedServices(): Map<string, IWorktreeService> {
		return new Map(this.worktreeServiceCache);
	}

	// ==================== Project Registry Methods ====================

	/**
	 * Load projects from disk, migrating from legacy format if needed
	 */
	public loadProjects(): void {
		try {
			if (existsSync(this.dataPath)) {
				// Load from new projects.json
				const data = readFileSync(this.dataPath, 'utf-8');
				this.projects = JSON.parse(data) || [];
			} else if (existsSync(this.legacyDataPath)) {
				// Migrate from recent-projects.json
				const data = readFileSync(this.legacyDataPath, 'utf-8');
				const legacyProjects = JSON.parse(data) || [];
				// Convert to new format (add isValid field)
				this.projects = legacyProjects.map(
					(p: {path: string; name: string; lastAccessed: number}) => ({
						...p,
						isValid: true,
					}),
				);
				// Save in new format
				this.saveProjects();
			}
		} catch (error) {
			console.error('Failed to load projects:', error);
			this.projects = [];
		}

		// Validate all projects on load
		this.validateProjects();
	}

	/**
	 * Save projects to disk
	 */
	private saveProjects(): void {
		try {
			writeFileSync(this.dataPath, JSON.stringify(this.projects, null, 2));
		} catch (error) {
			console.error('Failed to save projects:', error);
		}
	}

	/**
	 * Get all projects, sorted by lastAccessed (newest first)
	 */
	public getProjects(): Project[] {
		return [...this.projects].sort((a, b) => b.lastAccessed - a.lastAccessed);
	}

	/**
	 * Add a project to the registry
	 * @param projectPath - Absolute path to the project
	 * @param name - Optional display name (defaults to directory name)
	 * @returns The added project, or null if invalid
	 */
	public addProject(projectPath: string, name?: string): Project | null {
		// Expand ~ and resolve to absolute path
		const absolutePath = path.resolve(expandTilde(projectPath));

		// Check if already exists
		const existing = this.projects.find(p => p.path === absolutePath);
		if (existing) {
			// Update lastAccessed and optionally name
			existing.lastAccessed = Date.now();
			if (name !== undefined && name.trim()) {
				existing.name = name.trim();
			}
			existing.isValid = true;
			this.saveProjects();
			return existing;
		}

		// Validate it's a git repository (sync check)
		const gitPath = path.join(absolutePath, '.git');
		if (!existsSync(gitPath)) {
			return null;
		}

		// Create new project entry
		const project: Project = {
			path: absolutePath,
			name: name?.trim() || path.basename(absolutePath),
			lastAccessed: Date.now(),
			isValid: true,
		};

		this.projects.push(project);
		this.saveProjects();
		return project;
	}

	/**
	 * Remove a project from the registry
	 * @param projectPath - Path to the project to remove
	 * @returns true if removed, false if not found
	 */
	public removeProject(projectPath: string): boolean {
		const absolutePath = path.resolve(expandTilde(projectPath));
		const idx = this.projects.findIndex(p => p.path === absolutePath);
		if (idx === -1) {
			return false;
		}

		this.projects.splice(idx, 1);
		this.saveProjects();

		// Clear worktree service cache for this project
		this.worktreeServiceCache.delete(absolutePath);

		// Clear current project if it was removed
		if (this.currentProject?.path === absolutePath) {
			this.currentProject = undefined;
		}

		return true;
	}

	/**
	 * Update a project's metadata
	 * @param projectPath - Path to the project
	 * @param updates - Fields to update (name, description)
	 * @returns Updated project, or null if not found
	 */
	public updateProject(
		projectPath: string,
		updates: Partial<Pick<Project, 'name' | 'description'>>,
	): Project | null {
		const absolutePath = path.resolve(expandTilde(projectPath));
		const project = this.projects.find(p => p.path === absolutePath);
		if (!project) {
			return null;
		}

		if (updates.name !== undefined) {
			project.name = updates.name;
		}
		if (updates.description !== undefined) {
			project.description = updates.description;
		}

		this.saveProjects();
		return project;
	}

	/**
	 * Validate all projects - check if paths still exist
	 */
	public validateProjects(): void {
		let changed = false;
		for (const project of this.projects) {
			const exists = existsSync(project.path);
			const gitExists = existsSync(path.join(project.path, '.git'));
			const isValid = exists && gitExists;

			if (project.isValid !== isValid) {
				project.isValid = isValid;
				changed = true;
			}
		}
		if (changed) {
			this.saveProjects();
		}
	}

	/**
	 * Check if a path is a valid git repository
	 */
	async validateGitRepository(projectPath: string): Promise<boolean> {
		try {
			const gitPath = path.join(projectPath, '.git');
			const stats = await fs.stat(gitPath);
			return stats.isDirectory() || stats.isFile(); // File for worktrees
		} catch {
			return false;
		}
	}

	/**
	 * Check if a project is in the registry
	 */
	public hasProject(projectPath: string): boolean {
		const absolutePath = path.resolve(expandTilde(projectPath));
		return this.projects.some(p => p.path === absolutePath);
	}

	/**
	 * Get a project by path
	 */
	public getProject(projectPath: string): Project | undefined {
		const absolutePath = path.resolve(expandTilde(projectPath));
		return this.projects.find(p => p.path === absolutePath);
	}

	/**
	 * Convert a Project to GitProject format (for compatibility)
	 */
	public toGitProject(project: Project): GitProject {
		return {
			name: project.name,
			path: project.path,
			relativePath: project.name,
			isValid: project.isValid ?? true,
		};
	}

	// ==================== Task List Name Management ====================

	private static readonly MAX_TASK_LIST_NAMES = 20;

	/**
	 * Get stored task list names for a project
	 */
	public getTaskListNames(projectPath: string): string[] {
		const absolutePath = path.resolve(expandTilde(projectPath));
		const project = this.projects.find(p => p.path === absolutePath);
		return project?.metadata?.taskListNames || [];
	}

	/**
	 * Add a task list name to a project's metadata (deduplicated, max 20 entries)
	 */
	public addTaskListName(projectPath: string, name: string): boolean {
		const absolutePath = path.resolve(expandTilde(projectPath));
		const project = this.projects.find(p => p.path === absolutePath);
		if (!project) {
			return false;
		}

		// Initialize metadata if needed
		if (!project.metadata) {
			project.metadata = {};
		}
		if (!project.metadata.taskListNames) {
			project.metadata.taskListNames = [];
		}

		// Check if already exists (deduplicate)
		if (project.metadata.taskListNames.includes(name)) {
			return true; // Already exists, nothing to do
		}

		// Add to the beginning (most recent first)
		project.metadata.taskListNames.unshift(name);

		// Trim to max entries
		const names = project.metadata.taskListNames;
		if (names.length > ProjectManager.MAX_TASK_LIST_NAMES) {
			project.metadata.taskListNames = names.slice(
				0,
				ProjectManager.MAX_TASK_LIST_NAMES,
			);
		}

		this.saveProjects();
		return true;
	}

	/**
	 * Remove a task list name from a project's metadata
	 */
	public removeTaskListName(projectPath: string, name: string): boolean {
		const absolutePath = path.resolve(expandTilde(projectPath));
		const project = this.projects.find(p => p.path === absolutePath);
		if (!project?.metadata?.taskListNames) {
			return false;
		}

		const idx = project.metadata.taskListNames.indexOf(name);
		if (idx === -1) {
			return false;
		}

		project.metadata.taskListNames.splice(idx, 1);
		this.saveProjects();
		return true;
	}

	// ==================== Effect-based API methods ====================

	/**
	 * Load projects using Effect
	 */
	loadProjectsEffect(): Effect.Effect<
		Project[],
		FileSystemError | ConfigError,
		never
	> {
		return Effect.try({
			try: () => {
				if (existsSync(this.dataPath)) {
					const data = readFileSync(this.dataPath, 'utf-8');
					try {
						return JSON.parse(data) || [];
					} catch (parseError) {
						throw new ConfigError({
							configPath: this.dataPath,
							reason: 'parse',
							details: String(parseError),
						});
					}
				}
				return [];
			},
			catch: error => {
				if (error instanceof ConfigError) {
					return error;
				}
				return new FileSystemError({
					operation: 'read',
					path: this.dataPath,
					cause: String(error),
				});
			},
		});
	}

	/**
	 * Save projects using Effect
	 */
	saveProjectsEffect(
		projects: Project[],
	): Effect.Effect<void, FileSystemError, never> {
		return Effect.try({
			try: () => {
				writeFileSync(this.dataPath, JSON.stringify(projects, null, 2));
			},
			catch: error => {
				return new FileSystemError({
					operation: 'write',
					path: this.dataPath,
					cause: String(error),
				});
			},
		});
	}

	/**
	 * Add project using Effect
	 */
	addProjectEffect(
		projectPath: string,
		name?: string,
	): Effect.Effect<Project, FileSystemError, never> {
		return Effect.try({
			try: () => {
				const result = this.addProject(projectPath, name);
				if (!result) {
					throw new Error('Invalid git repository');
				}
				return result;
			},
			catch: error => {
				return new FileSystemError({
					operation: 'read',
					path: projectPath,
					cause: String(error),
				});
			},
		});
	}
}

// Create singleton instance
let _instance: ProjectManager | null = null;

export const projectManager = {
	get instance(): ProjectManager {
		if (!_instance) {
			_instance = new ProjectManager();
		}
		return _instance;
	},

	// Proxy methods for convenience
	getProjects() {
		return this.instance.getProjects();
	},

	loadProjects() {
		return this.instance.loadProjects();
	},

	addProject(projectPath: string, name?: string) {
		return this.instance.addProject(projectPath, name);
	},

	removeProject(projectPath: string) {
		return this.instance.removeProject(projectPath);
	},

	hasProject(projectPath: string) {
		return this.instance.hasProject(projectPath);
	},

	// Reset instance for testing
	_resetForTesting() {
		_instance = null;
	},
};
