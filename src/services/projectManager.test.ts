import {describe, it, expect, beforeEach, vi, afterEach} from 'vitest';
import * as fs from 'fs';
import path from 'path';
import {Effect, Either} from 'effect';

// Mock modules before any other imports that might use them
vi.mock('fs');
vi.mock('os', () => {
	const mockedOs = {
		homedir: vi.fn(() => '/home/user'),
		platform: vi.fn(() => 'linux'),
	};
	return {
		...mockedOs,
		default: mockedOs,
	};
});
vi.mock('../utils/configDir.js', () => ({
	getConfigDir: vi.fn(() => '/home/user/.config/cacd'),
}));

// Now import modules that depend on the mocked modules
import {ProjectManager} from './projectManager.js';
import {GitProject, Project} from '../types/index.js';
import {FileSystemError} from '../types/errors.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFs = fs as any;

describe('ProjectManager', () => {
	let projectManager: ProjectManager;
	const mockConfigDir = '/home/user/.config/cacd';
	const mockProjectsPath = path.join(mockConfigDir, 'projects.json');
	const mockLegacyPath = path.join(mockConfigDir, 'recent-projects.json');

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock fs methods for config directory
		mockFs.existsSync.mockImplementation((filePath: string) => {
			if (filePath === mockConfigDir) return true;
			if (filePath === mockProjectsPath) return false;
			if (filePath === mockLegacyPath) return false;
			return false;
		});
		mockFs.mkdirSync.mockImplementation(() => {});
		mockFs.readFileSync.mockImplementation(() => '[]');
		mockFs.writeFileSync.mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('initialization', () => {
		it('should initialize with empty projects list', () => {
			projectManager = new ProjectManager();
			expect(projectManager.currentProject).toBeUndefined();
			expect(projectManager.getProjects()).toEqual([]);
		});

		it('should load existing projects on initialization', () => {
			const mockProjects: Project[] = [
				{
					path: '/path/to/project1',
					name: 'project1',
					lastAccessed: Date.now(),
					isValid: true,
				},
				{
					path: '/path/to/project2',
					name: 'project2',
					lastAccessed: Date.now() - 1000,
					isValid: true,
				},
			];

			mockFs.existsSync.mockImplementation((filePath: string) => {
				if (filePath === mockConfigDir) return true;
				if (filePath === mockProjectsPath) return true;
				return false;
			});
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			projectManager = new ProjectManager();
			const projects = projectManager.getProjects();

			expect(projects).toHaveLength(2);
			expect(projects[0]?.name).toBe('project1');
		});

		it('should migrate from legacy recent-projects.json', () => {
			const legacyProjects = [
				{path: '/path/to/project1', name: 'project1', lastAccessed: Date.now()},
				{
					path: '/path/to/project2',
					name: 'project2',
					lastAccessed: Date.now() - 1000,
				},
			];

			mockFs.existsSync.mockImplementation((filePath: string) => {
				if (filePath === mockConfigDir) return true;
				if (filePath === mockProjectsPath) return false;
				if (filePath === mockLegacyPath) return true;
				// For validateProjects() called during load
				// Use path.join to match cross-platform separator behavior
				if (filePath === '/path/to/project1') return true;
				if (filePath === path.join('/path/to/project1', '.git')) return true;
				if (filePath === '/path/to/project2') return true;
				if (filePath === path.join('/path/to/project2', '.git')) return true;
				return false;
			});
			mockFs.readFileSync.mockReturnValue(JSON.stringify(legacyProjects));

			projectManager = new ProjectManager();
			const projects = projectManager.getProjects();

			expect(projects).toHaveLength(2);
			// Should have added isValid field during migration
			expect(projects[0]?.isValid).toBe(true);
			// Should have written new projects.json
			expect(mockFs.writeFileSync).toHaveBeenCalled();
		});
	});

	describe('getProjects', () => {
		it('should return projects sorted by lastAccessed (newest first)', () => {
			const mockProjects: Project[] = [
				{
					path: '/path/to/old',
					name: 'old',
					lastAccessed: Date.now() - 10000,
					isValid: true,
				},
				{
					path: '/path/to/new',
					name: 'new',
					lastAccessed: Date.now(),
					isValid: true,
				},
				{
					path: '/path/to/mid',
					name: 'mid',
					lastAccessed: Date.now() - 5000,
					isValid: true,
				},
			];

			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			projectManager = new ProjectManager();
			const projects = projectManager.getProjects();

			expect(projects[0]?.name).toBe('new');
			expect(projects[1]?.name).toBe('mid');
			expect(projects[2]?.name).toBe('old');
		});
	});

	describe('loadProjects', () => {
		it('should reload projects from disk when called directly', () => {
			projectManager = new ProjectManager();
			expect(projectManager.getProjects()).toHaveLength(0);

			const mockProjects: Project[] = [
				{
					path: '/path/to/project1',
					name: 'project1',
					lastAccessed: Date.now(),
					isValid: true,
				},
			];

			mockFs.existsSync.mockImplementation((filePath: string) => {
				if (filePath === mockConfigDir) return true;
				if (filePath === mockProjectsPath) return true;
				return false;
			});
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			// Act
			projectManager.loadProjects();

			// Assert
			const projects = projectManager.getProjects();
			expect(projects).toHaveLength(1);
			expect(projects[0]?.name).toBe('project1');
		});
	});

	describe('addProject', () => {
		beforeEach(() => {
			projectManager = new ProjectManager();
		});

		it('should add a valid git project', () => {
			// Mock .git directory exists
			mockFs.existsSync.mockImplementation((filePath: string) => {
				if (filePath.endsWith('.git')) return true;
				if (filePath === mockConfigDir) return true;
				return false;
			});

			const result = projectManager.addProject('/path/to/project');

			expect(result).not.toBeNull();
			expect(result?.name).toBe('project');
			expect(result?.path).toBe(path.resolve('/path/to/project'));
			expect(result?.isValid).toBe(true);
			expect(mockFs.writeFileSync).toHaveBeenCalled();
		});

		it('should add project with custom name', () => {
			mockFs.existsSync.mockImplementation((filePath: string) => {
				if (filePath.endsWith('.git')) return true;
				if (filePath === mockConfigDir) return true;
				return false;
			});

			const result = projectManager.addProject(
				'/path/to/project',
				'My Awesome Project',
			);

			expect(result?.name).toBe('My Awesome Project');
		});

		it('should return null for non-git directory', () => {
			mockFs.existsSync.mockImplementation((filePath: string) => {
				if (filePath.endsWith('.git')) return false;
				if (filePath === mockConfigDir) return true;
				return false;
			});

			const result = projectManager.addProject('/path/to/not-git');

			expect(result).toBeNull();
			expect(mockFs.writeFileSync).not.toHaveBeenCalled();
		});

		it('should update lastAccessed for existing project', () => {
			const existingProject: Project = {
				path: path.resolve('/path/to/project'),
				name: 'project',
				lastAccessed: Date.now() - 10000,
				isValid: true,
			};

			mockFs.existsSync.mockImplementation((filePath: string) => {
				if (filePath.endsWith('.git')) return true;
				if (filePath === mockConfigDir) return true;
				if (filePath === mockProjectsPath) return true;
				return false;
			});
			mockFs.readFileSync.mockReturnValue(JSON.stringify([existingProject]));

			projectManager = new ProjectManager();
			const result = projectManager.addProject('/path/to/project');

			expect(result).not.toBeNull();
			expect(result!.lastAccessed).toBeGreaterThan(
				existingProject.lastAccessed,
			);
		});
	});

	describe('removeProject', () => {
		it('should remove an existing project', () => {
			const resolvedPath1 = path.resolve('/path/to/project1');
			const resolvedPath2 = path.resolve('/path/to/project2');
			const mockProjects: Project[] = [
				{
					path: resolvedPath1,
					name: 'project1',
					lastAccessed: Date.now(),
					isValid: true,
				},
				{
					path: resolvedPath2,
					name: 'project2',
					lastAccessed: Date.now(),
					isValid: true,
				},
			];

			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			projectManager = new ProjectManager();
			const result = projectManager.removeProject('/path/to/project1');

			expect(result).toBe(true);
			expect(projectManager.getProjects()).toHaveLength(1);
			expect(projectManager.getProjects()[0]?.name).toBe('project2');
		});

		it('should return false for non-existent project', () => {
			projectManager = new ProjectManager();
			const result = projectManager.removeProject('/path/to/nonexistent');

			expect(result).toBe(false);
		});
	});

	describe('updateProject', () => {
		it('should update project name', () => {
			const resolvedPath = path.resolve('/path/to/project');
			const mockProjects: Project[] = [
				{
					path: resolvedPath,
					name: 'old-name',
					lastAccessed: Date.now(),
					isValid: true,
				},
			];

			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			projectManager = new ProjectManager();
			const result = projectManager.updateProject('/path/to/project', {
				name: 'new-name',
			});

			expect(result?.name).toBe('new-name');
		});

		it('should update project description', () => {
			const resolvedPath = path.resolve('/path/to/project');
			const mockProjects: Project[] = [
				{
					path: resolvedPath,
					name: 'project',
					lastAccessed: Date.now(),
					isValid: true,
				},
			];

			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			projectManager = new ProjectManager();
			const result = projectManager.updateProject('/path/to/project', {
				description: 'Updated desc',
			});

			expect(result?.description).toBe('Updated desc');
		});

		it('should return null for non-existent project', () => {
			projectManager = new ProjectManager();
			const result = projectManager.updateProject('/path/to/nonexistent', {
				name: 'new-name',
			});

			expect(result).toBeNull();
		});
	});

	describe('hasProject', () => {
		it('should return true for existing project', () => {
			const resolvedPath = path.resolve('/path/to/project');
			const mockProjects: Project[] = [
				{
					path: resolvedPath,
					name: 'project',
					lastAccessed: Date.now(),
					isValid: true,
				},
			];

			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			projectManager = new ProjectManager();
			expect(projectManager.hasProject('/path/to/project')).toBe(true);
		});

		it('should return false for non-existent project', () => {
			projectManager = new ProjectManager();
			expect(projectManager.hasProject('/path/to/nonexistent')).toBe(false);
		});
	});

	describe('getProject', () => {
		it('should return project by path', () => {
			const resolvedPath = path.resolve('/path/to/project');
			const mockProjects: Project[] = [
				{
					path: resolvedPath,
					name: 'project',
					lastAccessed: Date.now(),
					isValid: true,
				},
			];

			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			projectManager = new ProjectManager();
			const result = projectManager.getProject('/path/to/project');

			expect(result?.name).toBe('project');
		});

		it('should return undefined for non-existent project', () => {
			projectManager = new ProjectManager();
			const result = projectManager.getProject('/path/to/nonexistent');

			expect(result).toBeUndefined();
		});
	});

	describe('validateProjects', () => {
		it('should mark invalid projects', () => {
			const mockProjects: Project[] = [
				{
					path: '/path/to/valid',
					name: 'valid',
					lastAccessed: Date.now(),
					isValid: true,
				},
				{
					path: '/path/to/invalid',
					name: 'invalid',
					lastAccessed: Date.now(),
					isValid: true,
				},
			];

			mockFs.existsSync.mockImplementation((filePath: string) => {
				if (filePath === mockConfigDir) return true;
				if (filePath === mockProjectsPath) return true;
				// Valid project - both path and .git exist
				if (filePath === '/path/to/valid') return true;
				if (filePath === path.join('/path/to/valid', '.git')) return true;
				// Invalid project - path doesn't exist
				if (filePath === '/path/to/invalid') return false;
				if (filePath === path.join('/path/to/invalid', '.git')) return false;
				return false;
			});
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			projectManager = new ProjectManager();
			// validateProjects is already called during load, but let's ensure state is correct
			const projects = projectManager.getProjects();
			const validProject = projects.find(p => p.name === 'valid');
			const invalidProject = projects.find(p => p.name === 'invalid');

			expect(validProject?.isValid).toBe(true);
			expect(invalidProject?.isValid).toBe(false);
		});
	});

	describe('selectProject', () => {
		it('should select a project and update lastAccessed', () => {
			const resolvedPath = path.resolve('/path/to/project');
			const mockProjects: Project[] = [
				{
					path: resolvedPath,
					name: 'project',
					lastAccessed: Date.now() - 10000,
					isValid: true,
				},
			];

			mockFs.existsSync.mockReturnValue(true);
			mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

			projectManager = new ProjectManager();
			const initialLastAccessed = projectManager.getProjects()[0]?.lastAccessed;

			const gitProject: GitProject = {
				name: 'project',
				path: resolvedPath,
				relativePath: 'project',
				isValid: true,
			};

			projectManager.selectProject(gitProject);

			expect(projectManager.currentProject).toBe(gitProject);
			expect(projectManager.getProjects()[0]?.lastAccessed).toBeGreaterThan(
				initialLastAccessed!,
			);
		});
	});

	describe('toGitProject', () => {
		it('should convert Project to GitProject', () => {
			projectManager = new ProjectManager();

			const project: Project = {
				path: '/path/to/project',
				name: 'project',
				description: 'Test project',
				lastAccessed: Date.now(),
				isValid: true,
			};

			const gitProject = projectManager.toGitProject(project);

			expect(gitProject.path).toBe(project.path);
			expect(gitProject.name).toBe(project.name);
			expect(gitProject.relativePath).toBe(project.name);
			expect(gitProject.isValid).toBe(project.isValid);
		});
	});

	describe('worktree service management', () => {
		beforeEach(() => {
			projectManager = new ProjectManager();
		});

		it('should get worktree service for current project', () => {
			const project: GitProject = {
				name: 'test',
				path: '/test/project',
				relativePath: 'test',
				isValid: true,
			};

			projectManager.selectProject(project);
			const service = projectManager.getWorktreeService();

			expect(service).toBeDefined();
			expect(service.getGitRootPath()).toBe(path.resolve('/test/project'));
		});

		it('should cache worktree services', () => {
			const service1 = projectManager.getWorktreeService('/test/path1');
			const service2 = projectManager.getWorktreeService('/test/path1');

			expect(service1).toBe(service2);
		});

		it('should clear worktree service cache', () => {
			projectManager.getWorktreeService('/test/path1');
			projectManager.getWorktreeService('/test/path2');

			projectManager.clearWorktreeServiceCache('/test/path1');

			const cachedServices = projectManager.getCachedServices();
			expect(cachedServices.size).toBe(1);
			expect(cachedServices.has('/test/path2')).toBe(true);
		});

		it('should clear all worktree service cache', () => {
			projectManager.getWorktreeService('/test/path1');
			projectManager.getWorktreeService('/test/path2');

			projectManager.clearWorktreeServiceCache();

			const cachedServices = projectManager.getCachedServices();
			expect(cachedServices.size).toBe(0);
		});
	});

	describe('project validation', () => {
		beforeEach(() => {
			projectManager = new ProjectManager();
		});

		it('should validate a git repository', async () => {
			mockFs.promises = {
				stat: vi.fn().mockResolvedValue({
					isDirectory: () => true,
					isFile: () => false,
				}),
			};

			const isValid = await projectManager.validateGitRepository('/test/repo');
			expect(isValid).toBe(true);
		});

		it('should invalidate non-git repository', async () => {
			mockFs.promises = {
				stat: vi.fn().mockRejectedValue(new Error('Not found')),
			};

			const isValid =
				await projectManager.validateGitRepository('/test/not-repo');
			expect(isValid).toBe(false);
		});
	});

	describe('getCurrentProjectPath', () => {
		it('should return cwd when no project selected', () => {
			projectManager = new ProjectManager();
			const cwd = process.cwd();
			expect(projectManager.getCurrentProjectPath()).toBe(cwd);
		});

		it('should return project path when project selected', () => {
			projectManager = new ProjectManager();
			const project: GitProject = {
				name: 'test',
				path: '/test/project',
				relativePath: 'test',
				isValid: true,
			};

			projectManager.selectProject(project);
			expect(projectManager.getCurrentProjectPath()).toBe('/test/project');
		});
	});

	describe('Effect-based API', () => {
		describe('loadProjectsEffect', () => {
			it('should return Effect with projects on success', async () => {
				const mockProjects: Project[] = [
					{
						path: '/path/to/project1',
						name: 'project1',
						lastAccessed: Date.now(),
						isValid: true,
					},
					{
						path: '/path/to/project2',
						name: 'project2',
						lastAccessed: Date.now() - 1000,
						isValid: true,
					},
				];

				mockFs.existsSync.mockReturnValue(true);
				mockFs.readFileSync.mockReturnValue(JSON.stringify(mockProjects));

				projectManager = new ProjectManager();
				const effect = projectManager.loadProjectsEffect();
				const projects = await Effect.runPromise(effect);

				expect(projects).toHaveLength(2);
				expect(projects[0]?.name).toBe('project1');
			});

			it('should return empty array when file does not exist', async () => {
				mockFs.existsSync.mockReturnValue(false);

				projectManager = new ProjectManager();
				const effect = projectManager.loadProjectsEffect();
				const projects = await Effect.runPromise(effect);

				expect(projects).toEqual([]);
			});
		});

		describe('saveProjectsEffect', () => {
			it('should return Effect with void on success', async () => {
				mockFs.writeFileSync.mockImplementation(() => {});

				projectManager = new ProjectManager();
				const projects: Project[] = [
					{
						path: '/path/to/project1',
						name: 'project1',
						lastAccessed: Date.now(),
						isValid: true,
					},
				];

				const effect = projectManager.saveProjectsEffect(projects);
				await Effect.runPromise(effect);

				expect(mockFs.writeFileSync).toHaveBeenCalledWith(
					mockProjectsPath,
					expect.any(String),
				);
			});

			it('should return Effect with FileSystemError when write fails', async () => {
				mockFs.writeFileSync.mockImplementation(() => {
					throw new Error('Disk full');
				});

				projectManager = new ProjectManager();
				const projects: Project[] = [
					{
						path: '/path/to/project1',
						name: 'project1',
						lastAccessed: Date.now(),
						isValid: true,
					},
				];

				const effect = projectManager.saveProjectsEffect(projects);
				const result = await Effect.runPromise(Effect.either(effect));

				expect(Either.isLeft(result)).toBe(true);
				if (Either.isLeft(result)) {
					const error = result.left;
					expect(error._tag).toBe('FileSystemError');
					expect(error).toBeInstanceOf(FileSystemError);
					expect(error.operation).toBe('write');
				}
			});
		});

		describe('addProjectEffect', () => {
			it('should return Effect with project on success', async () => {
				mockFs.existsSync.mockImplementation((filePath: string) => {
					if (filePath.endsWith('.git')) return true;
					if (filePath === mockConfigDir) return true;
					return false;
				});

				projectManager = new ProjectManager();
				const effect = projectManager.addProjectEffect('/path/to/project');
				const result = await Effect.runPromise(effect);

				expect(result.name).toBe('project');
				expect(result.path).toBe(path.resolve('/path/to/project'));
			});
		});
	});
});
