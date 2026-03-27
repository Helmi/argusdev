import {ApiClientError, createApiClient} from '../apiClient.js';
import type {CliCommandContext} from '../types.js';
import type {Project} from '../../types/index.js';

interface ApiProjectsResponse {
	projects: Project[];
}

interface ApiProjectMutationResponse {
	success: boolean;
	project?: Project;
	error?: string;
}

function createDaemonApiClient(context: CliCommandContext) {
	return createApiClient({
		host: '127.0.0.1',
		port: context.port,
		accessToken: context.accessToken,
	});
}

function isFallbackEligibleApiError(error: unknown): boolean {
	if (!(error instanceof ApiClientError)) {
		return false;
	}

	return error.message.includes('Unable to connect to ArgusDev daemon at');
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function resolveProjectAction(context: CliCommandContext): {
	action: string;
	commandLabel: string;
} {
	if (context.subcommand === 'project') {
		const action = context.parsedArgs.input[1] ?? 'list';
		return {action, commandLabel: `project ${action}`};
	}

	return {action: context.subcommand, commandLabel: context.subcommand};
}

function resolvePathArg(
	context: CliCommandContext,
	action: string,
): string | undefined {
	const offset = context.subcommand === 'project' ? 2 : 1;
	const value = context.parsedArgs.input[offset];
	if (value) {
		return value;
	}

	if (action === 'add') {
		return process.cwd();
	}

	return undefined;
}

function writeProjectListOutput(
	context: CliCommandContext,
	commandLabel: string,
	projects: Project[],
): number {
	if (projects.length === 0) {
		context.formatter.write({
			text: [
				'No projects tracked yet.',
				'',
				'Add a project with:',
				'  argusdev add .              # Add current directory',
				'  argusdev project add /path/to/repo',
			],
			data: {
				ok: true,
				command: commandLabel,
				count: 0,
				projects: [],
			},
		});
		return 0;
	}

	const lines = [`Tracked projects (${projects.length}):`, ''];
	for (const project of projects) {
		const status = project.isValid === false ? 'invalid' : 'valid';
		lines.push(`- ${project.name}`);
		lines.push(`  path: ${project.path}`);
		lines.push(`  status: ${status}`);
		if (project.description !== undefined && project.description.length > 0) {
			lines.push(`  description: ${project.description}`);
		}
		lines.push('');
	}

	context.formatter.write({
		text: lines.slice(0, -1),
		data: {
			ok: true,
			command: commandLabel,
			count: projects.length,
			projects,
		},
	});

	return 0;
}

async function handleAdd(
	context: CliCommandContext,
	commandLabel: string,
): Promise<number> {
	const {services, formatter} = context;
	const projectPath = resolvePathArg(context, 'add') || process.cwd();

	let result: Project | null = null;
	try {
		const client = createDaemonApiClient(context);
		const response = await client.post<ApiProjectMutationResponse>(
			'/api/project/add',
			{path: projectPath},
		);
		result = response.project ?? null;
	} catch (error) {
		if (!isFallbackEligibleApiError(error)) {
			formatter.writeError({
				text: [`Failed to add project: ${toErrorMessage(error)}`],
				data: {
					ok: false,
					command: commandLabel,
					error: {
						message: toErrorMessage(error),
					},
				},
			});
			return 1;
		}

		result = services.projectManager.addProject(projectPath);
	}

	if (result) {
		formatter.write({
			text: [`✓ Added project: ${result.name}`, `  Path: ${result.path}`],
			data: {
				ok: true,
				command: commandLabel,
				project: result,
			},
		});
		return 0;
	}

	formatter.writeError({
		text: [
			`✗ Failed to add project: ${projectPath}`,
			'  Not a valid git repository (no .git directory found)',
		],
		data: {
			ok: false,
			command: commandLabel,
			error: {
				message: `Failed to add project: ${projectPath}`,
				reason: 'Not a valid git repository (no .git directory found)',
			},
		},
	});
	return 1;
}

async function handleRemove(
	context: CliCommandContext,
	commandLabel: string,
): Promise<number> {
	const {services, formatter} = context;
	const projectPath = resolvePathArg(context, 'remove');
	if (!projectPath) {
		formatter.writeError({
			text: [
				'Error: Path required for remove command',
				context.subcommand === 'project'
					? 'Usage: argusdev project remove <path>'
					: 'Usage: argusdev remove <path>',
			],
			data: {
				ok: false,
				command: commandLabel,
				error: {
					message: 'Path required for remove command',
					usage:
						context.subcommand === 'project'
							? 'argusdev project remove <path>'
							: 'argusdev remove <path>',
				},
			},
		});
		return 1;
	}

	let removed = false;
	try {
		const client = createDaemonApiClient(context);
		const response = await client.post<ApiProjectMutationResponse>(
			'/api/project/remove',
			{path: projectPath},
		);
		removed = response.success;
	} catch (error) {
		if (!isFallbackEligibleApiError(error)) {
			formatter.writeError({
				text: [`Failed to remove project: ${toErrorMessage(error)}`],
				data: {
					ok: false,
					command: commandLabel,
					error: {
						message: toErrorMessage(error),
					},
				},
			});
			return 1;
		}

		removed = services.projectManager.removeProject(projectPath);
	}

	if (removed) {
		formatter.write({
			text: [`✓ Removed project: ${projectPath}`],
			data: {
				ok: true,
				command: commandLabel,
				path: projectPath,
			},
		});
		return 0;
	}

	formatter.writeError({
		text: [`✗ Project not found: ${projectPath}`],
		data: {
			ok: false,
			command: commandLabel,
			error: {
				message: `Project not found: ${projectPath}`,
			},
		},
	});
	return 1;
}

async function handleList(
	context: CliCommandContext,
	commandLabel: string,
): Promise<number> {
	let projects: Project[];

	try {
		const client = createDaemonApiClient(context);
		const response = await client.get<ApiProjectsResponse>('/api/projects');
		projects = response.projects;
	} catch (error) {
		if (!isFallbackEligibleApiError(error)) {
			context.formatter.writeError({
				text: [`Failed to list projects: ${toErrorMessage(error)}`],
				data: {
					ok: false,
					command: commandLabel,
					error: {
						message: toErrorMessage(error),
					},
				},
			});
			return 1;
		}

		context.services.projectManager.instance.validateProjects();
		projects = context.services.projectManager.getProjects();
	}

	return writeProjectListOutput(context, commandLabel, projects);
}

async function handleConfigure(
	context: CliCommandContext,
	commandLabel: string,
): Promise<number> {
	const projectPath = resolvePathArg(context, 'configure');
	if (!projectPath) {
		context.formatter.writeError({
			text: [
				'Error: Path required for configure command',
				'Usage: argusdev project configure <path> [--name <name>] [--description <desc>]',
			],
			data: {
				ok: false,
				command: commandLabel,
				error: {
					message: 'Path required for configure command',
					usage:
						'argusdev project configure <path> [--name <name>] [--description <desc>]',
				},
			},
		});
		return 1;
	}

	const hasNameUpdate = context.parsedArgs.flags.name !== undefined;
	const hasDescriptionUpdate =
		context.parsedArgs.flags.description !== undefined;
	if (!hasNameUpdate && !hasDescriptionUpdate) {
		context.formatter.writeError({
			text: [
				'Error: No updates provided',
				'Use at least one option: --name <name> or --description <desc>',
			],
			data: {
				ok: false,
				command: commandLabel,
				error: {
					message: 'No updates provided',
					required: ['--name', '--description'],
				},
			},
		});
		return 1;
	}

	const trimmedName = context.parsedArgs.flags.name?.trim();
	if (hasNameUpdate && !trimmedName) {
		context.formatter.writeError({
			text: ['Error: --name must not be empty'],
			data: {
				ok: false,
				command: commandLabel,
				error: {
					message: '--name must not be empty',
				},
			},
		});
		return 1;
	}

	const updates: Partial<Pick<Project, 'name' | 'description'>> = {};
	if (hasNameUpdate) {
		updates.name = trimmedName;
	}
	if (hasDescriptionUpdate) {
		updates.description = context.parsedArgs.flags.description;
	}

	let updatedProject: Project | null = null;
	let shouldFallbackToLocal = false;

	try {
		const client = createDaemonApiClient(context);
		const response = await client.post<ApiProjectMutationResponse>(
			'/api/project/update',
			{path: projectPath, ...updates},
		);
		updatedProject = response.project ?? null;
	} catch (error) {
		if (!isFallbackEligibleApiError(error)) {
			context.formatter.writeError({
				text: [`Failed to configure project: ${toErrorMessage(error)}`],
				data: {
					ok: false,
					command: commandLabel,
					error: {
						message: toErrorMessage(error),
					},
				},
			});
			return 1;
		}

		shouldFallbackToLocal = true;
	}

	if (shouldFallbackToLocal) {
		updatedProject = context.services.projectManager.instance.updateProject(
			projectPath,
			updates,
		);
	} else if (!updatedProject) {
		context.formatter.writeError({
			text: ['Failed to configure project: daemon returned no updated project'],
			data: {
				ok: false,
				command: commandLabel,
				error: {
					message:
						'Failed to configure project: daemon returned no updated project',
				},
			},
		});
		return 1;
	}

	if (!updatedProject) {
		context.formatter.writeError({
			text: [`✗ Project not found: ${projectPath}`],
			data: {
				ok: false,
				command: commandLabel,
				error: {
					message: `Project not found: ${projectPath}`,
				},
			},
		});
		return 1;
	}

	const lines = [`✓ Updated project: ${updatedProject.path}`];
	if (updates.name !== undefined) {
		lines.push(`  Name: ${updatedProject.name}`);
	}
	if (updates.description !== undefined) {
		lines.push(
			`  Description: ${updatedProject.description?.length ? updatedProject.description : '(empty)'}`,
		);
	}

	context.formatter.write({
		text: lines,
		data: {
			ok: true,
			command: commandLabel,
			project: updatedProject,
			updates,
		},
	});

	return 0;
}

export async function runProjectCommand(
	context: CliCommandContext,
): Promise<number> {
	const {action, commandLabel} = resolveProjectAction(context);

	if (action === 'add') {
		return handleAdd(context, commandLabel);
	}

	if (action === 'remove') {
		return handleRemove(context, commandLabel);
	}

	if (action === 'list') {
		return handleList(context, commandLabel);
	}

	if (action === 'configure') {
		if (context.subcommand !== 'project') {
			context.formatter.writeError({
				text: [
					'Error: configure is available under `argusdev project configure` only',
				],
				data: {
					ok: false,
					command: commandLabel,
					error: {
						message:
							'configure is available under `argusdev project configure` only',
					},
				},
			});
			return 1;
		}

		return handleConfigure(context, commandLabel);
	}

	if (context.subcommand === 'project') {
		context.formatter.writeError({
			text: [
				`Unknown project command: ${action}`,
				'',
				'Available project commands:',
				'  argusdev project add [path]',
				'  argusdev project list',
				'  argusdev project remove <path>',
				'  argusdev project configure <path> [--name <name>] [--description <desc>]',
			],
			data: {
				ok: false,
				command: 'project',
				error: {
					message: `Unknown project command: ${action}`,
					available: ['add', 'list', 'remove', 'configure'],
				},
			},
		});
		return 1;
	}

	context.formatter.writeError({
		text: [`Unsupported project command alias: ${action}`],
		data: {
			ok: false,
			command: commandLabel,
			error: {
				message: `Unsupported project command alias: ${action}`,
			},
		},
	});
	return 1;
}
