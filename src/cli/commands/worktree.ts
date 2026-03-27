import type {ConfigurationData} from '../../types/index.js';
import {generateWorktreeDirectory} from '../../utils/worktreeUtils.js';
import {ApiClientError, createApiClient} from '../apiClient.js';
import type {CliCommandContext} from '../types.js';

interface ApiWorktreePayload {
	path: string;
	branch?: string;
	isMainWorktree: boolean;
	hasSession: boolean;
	gitStatus?: {
		parentBranch: string | null;
	};
}

interface ApiSessionPayload {
	id: string;
	path: string;
	state: string;
}

interface ApiStateResponse {
	selectedProject?: {
		path: string;
	} | null;
}

interface ApiCreateWorktreeResponse {
	success: boolean;
	warnings?: string[];
	worktree?: {
		path?: string;
		branch?: string;
		warnings?: string[];
	};
}

const WORKTREE_API_NOT_SUPPORTED_MESSAGE =
	'Worktree command not yet supported by this daemon version — requires running daemon with worktree API support.';

function createDaemonApiClient(context: CliCommandContext) {
	return createApiClient({
		host: '127.0.0.1',
		port: context.port,
		accessToken: context.accessToken,
	});
}

function normalizeApiError(error: unknown): Error {
	if (error instanceof ApiClientError) {
		if (error.status === 401 || error.status === 403) {
			return new Error(
				'Daemon API authentication failed. Verify local config token and daemon state.',
			);
		}

		if (error.message.includes('Unable to connect to ArgusDev daemon at')) {
			return new Error(
				'No running ArgusDev daemon found. Start it with `argusdev start`.',
			);
		}

		return new Error(error.message);
	}

	if (error instanceof Error) {
		return error;
	}

	return new Error(String(error));
}

function isMissingWorktreeApi(error: unknown): boolean {
	if (!(error instanceof ApiClientError)) {
		return false;
	}

	return error.status === 404;
}

async function fetchDaemonApi<T>(
	context: CliCommandContext,
	path: string,
): Promise<T> {
	try {
		const client = createDaemonApiClient(context);
		return await client.get<T>(path);
	} catch (error) {
		if (
			isMissingWorktreeApi(error) &&
			(path.startsWith('/api/worktree') || path.startsWith('/api/worktrees'))
		) {
			throw new Error(WORKTREE_API_NOT_SUPPORTED_MESSAGE);
		}

		throw normalizeApiError(error);
	}
}

async function postDaemonApi<T>(
	context: CliCommandContext,
	path: string,
	body: unknown,
): Promise<T> {
	try {
		const client = createDaemonApiClient(context);
		return await client.post<T>(path, body);
	} catch (error) {
		if (isMissingWorktreeApi(error)) {
			throw new Error(WORKTREE_API_NOT_SUPPORTED_MESSAGE);
		}

		throw normalizeApiError(error);
	}
}

function normalizeBranchName(branch: string | undefined): string {
	if (!branch) {
		return '-';
	}

	return branch.replace(/^refs\/heads\//, '');
}

function buildTableLines(headers: string[], rows: string[][]): string[] {
	const widths = headers.map((header, index) => {
		const rowWidths = rows.map(row => row[index]?.length ?? 0);
		return Math.max(header.length, ...rowWidths);
	});

	const formatRow = (cells: string[]) =>
		cells.map((cell, index) => cell.padEnd(widths[index] || 0)).join('  ');

	const lines = [
		formatRow(headers),
		widths.map(width => '-'.repeat(width)).join('  '),
	];
	for (const row of rows) {
		lines.push(formatRow(row));
	}

	return lines;
}

function worktreeBelongsToProject(
	worktreePath: string,
	projectPath: string,
): boolean {
	if (worktreePath.startsWith(projectPath)) {
		return true;
	}

	const projectName = projectPath.split('/').pop();
	if (!projectName) {
		return false;
	}

	return worktreePath.includes(`/.worktrees/${projectName}/`);
}

async function resolveProjectPath(
	context: CliCommandContext,
): Promise<string | undefined> {
	const explicitPath = context.parsedArgs.flags.project?.trim();
	if (explicitPath) {
		return explicitPath;
	}

	const state = await fetchDaemonApi<ApiStateResponse>(context, '/api/state');
	return state.selectedProject?.path ?? undefined;
}

async function runWorktreeCreateCommand(
	context: CliCommandContext,
): Promise<number> {
	const branchFlag = context.parsedArgs.flags.branch?.trim();
	const taskId = context.parsedArgs.flags.task?.trim();
	const branch = branchFlag || taskId;

	if (!branch) {
		context.formatter.writeError({
			text: [
				'Error: Missing branch. Provide --branch <name> or --task <td-task-id>.',
				'Usage: argusdev worktree create [--branch <name>] [--project <path>] [--task <td-task-id>]',
			],
			data: {
				ok: false,
				command: 'worktree create',
				error: {
					message:
						'Missing branch. Provide --branch <name> or --task <td-task-id>.',
					usage:
						'argusdev worktree create [--branch <name>] [--project <path>] [--task <td-task-id>]',
				},
			},
		});
		return 1;
	}

	let projectPath: string | undefined;
	try {
		projectPath = await resolveProjectPath(context);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.formatter.writeError({
			text: [`Failed to resolve project context: ${message}`],
			data: {
				ok: false,
				command: 'worktree create',
				error: {message},
			},
		});
		return 1;
	}

	if (!projectPath) {
		context.formatter.writeError({
			text: [
				'No project selected. Use --project <path> or select a project in the daemon first.',
			],
			data: {
				ok: false,
				command: 'worktree create',
				error: {
					message:
						'No project selected. Use --project <path> or select a project in the daemon first.',
				},
			},
		});
		return 1;
	}

	let config: ConfigurationData | undefined;
	try {
		config = await fetchDaemonApi<ConfigurationData>(context, '/api/config');
	} catch {
		// Optional: if config endpoint fails we can still proceed with defaults.
	}

	let baseBranch = 'main';
	try {
		const query = `?projectPath=${encodeURIComponent(projectPath)}`;
		const response = await fetchDaemonApi<{defaultBranch: string}>(
			context,
			`/api/branches/default${query}`,
		);
		baseBranch = response.defaultBranch || baseBranch;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.formatter.writeError({
			text: [`Failed to resolve default branch: ${message}`],
			data: {
				ok: false,
				command: 'worktree create',
				error: {message},
			},
		});
		return 1;
	}

	const worktreePath = generateWorktreeDirectory(
		projectPath,
		branch,
		config?.worktree?.autoDirectoryPattern,
	);
	const copySessionData = config?.worktree?.copySessionData ?? true;

	let result: ApiCreateWorktreeResponse;
	try {
		result = await postDaemonApi<ApiCreateWorktreeResponse>(
			context,
			'/api/worktree/create',
			{
				path: worktreePath,
				branch,
				baseBranch,
				copySessionData,
				copyClaudeDirectory: true,
				projectPath,
				taskId,
			},
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.formatter.writeError({
			text: [`Failed to create worktree: ${message}`],
			data: {
				ok: false,
				command: 'worktree create',
				error: {message},
			},
		});
		return 1;
	}

	const createdPath = result.worktree?.path || worktreePath;
	const warnings = result.warnings ?? result.worktree?.warnings ?? [];
	const lines = [
		`Created worktree: ${createdPath}`,
		`Branch: ${normalizeBranchName(result.worktree?.branch || branch)}`,
		`Base branch: ${baseBranch}`,
	];
	if (warnings.length > 0) {
		lines.push('', 'Warnings:');
		for (const warning of warnings) {
			lines.push(`  - ${warning}`);
		}
	}

	context.formatter.write({
		text: lines,
		data: {
			ok: true,
			command: 'worktree create',
			worktree: {
				path: createdPath,
				branch: normalizeBranchName(result.worktree?.branch || branch),
				baseBranch,
				projectPath,
				taskId: taskId || null,
				warnings,
			},
		},
	});
	return 0;
}

async function runWorktreeListCommand(
	context: CliCommandContext,
): Promise<number> {
	const projectPath = context.parsedArgs.flags.project?.trim();

	let worktrees: ApiWorktreePayload[];
	let sessions: ApiSessionPayload[];
	try {
		[worktrees, sessions] = await Promise.all([
			fetchDaemonApi<ApiWorktreePayload[]>(context, '/api/worktrees'),
			fetchDaemonApi<ApiSessionPayload[]>(context, '/api/sessions'),
		]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.formatter.writeError({
			text: [`Failed to list worktrees: ${message}`],
			data: {
				ok: false,
				command: 'worktree list',
				error: {message},
			},
		});
		return 1;
	}

	const scopedWorktrees = projectPath
		? worktrees.filter(worktree =>
				worktreeBelongsToProject(worktree.path, projectPath),
			)
		: worktrees;

	const result = scopedWorktrees.map(worktree => {
		const linkedSessions = sessions.filter(
			session => session.path === worktree.path,
		);
		const sessionIds = linkedSessions.map(session => session.id);
		const sessionStates = [
			...new Set(linkedSessions.map(session => session.state)),
		];

		const statusParts: string[] = [];
		if (worktree.isMainWorktree) {
			statusParts.push('main');
		}
		if (sessionStates.length > 0) {
			statusParts.push(`session:${sessionStates.join(',')}`);
		}
		if (statusParts.length === 0) {
			statusParts.push('idle');
		}

		return {
			path: worktree.path,
			branch: normalizeBranchName(worktree.branch),
			status: statusParts.join(' '),
			hasSession: worktree.hasSession,
			linkedSessionId: sessionIds[0] || null,
			linkedSessionIds: sessionIds,
			isMainWorktree: worktree.isMainWorktree,
		};
	});

	if (result.length === 0) {
		const message = projectPath
			? `No worktrees found for project: ${projectPath}`
			: 'No worktrees found';
		context.formatter.write({
			text: [message],
			data: {
				ok: true,
				command: 'worktree list',
				projectPath: projectPath || null,
				worktrees: [],
			},
		});
		return 0;
	}

	context.formatter.write({
		text: buildTableLines(
			['path', 'branch', 'status', 'session'],
			result.map(worktree => [
				worktree.path,
				worktree.branch,
				worktree.status,
				worktree.linkedSessionId || '-',
			]),
		),
		data: {
			ok: true,
			command: 'worktree list',
			projectPath: projectPath || null,
			worktrees: result,
		},
	});
	return 0;
}

async function runWorktreeDeleteCommand(
	context: CliCommandContext,
): Promise<number> {
	const worktreePath = context.parsedArgs.input[2]?.trim();
	if (!worktreePath) {
		context.formatter.writeError({
			text: [
				'Error: Missing worktree path',
				'Usage: argusdev worktree delete <path>',
			],
			data: {
				ok: false,
				command: 'worktree delete',
				error: {
					message: 'Missing worktree path',
					usage: 'argusdev worktree delete <path>',
				},
			},
		});
		return 1;
	}

	const projectPath = context.parsedArgs.flags.project?.trim();

	try {
		await postDaemonApi<{success: boolean}>(context, '/api/worktree/delete', {
			path: worktreePath,
			deleteBranch: false,
			projectPath,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.formatter.writeError({
			text: [`Failed to delete worktree: ${message}`],
			data: {
				ok: false,
				command: 'worktree delete',
				error: {message},
			},
		});
		return 1;
	}

	context.formatter.write({
		text: [`Deleted worktree: ${worktreePath}`],
		data: {
			ok: true,
			command: 'worktree delete',
			path: worktreePath,
		},
	});
	return 0;
}

async function runWorktreeMergeCommand(
	context: CliCommandContext,
): Promise<number> {
	const worktreePath = context.parsedArgs.input[2]?.trim();
	if (!worktreePath) {
		context.formatter.writeError({
			text: [
				'Error: Missing worktree path',
				'Usage: argusdev worktree merge <path> [--target <branch>]',
			],
			data: {
				ok: false,
				command: 'worktree merge',
				error: {
					message: 'Missing worktree path',
					usage: 'argusdev worktree merge <path> [--target <branch>]',
				},
			},
		});
		return 1;
	}

	let worktrees: ApiWorktreePayload[];
	try {
		worktrees = await fetchDaemonApi<ApiWorktreePayload[]>(
			context,
			'/api/worktrees',
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.formatter.writeError({
			text: [`Failed to resolve worktree branch: ${message}`],
			data: {
				ok: false,
				command: 'worktree merge',
				error: {message},
			},
		});
		return 1;
	}

	const worktree = worktrees.find(item => item.path === worktreePath);
	if (!worktree) {
		context.formatter.writeError({
			text: [`Worktree not found: ${worktreePath}`],
			data: {
				ok: false,
				command: 'worktree merge',
				error: {
					message: `Worktree not found: ${worktreePath}`,
				},
			},
		});
		return 1;
	}

	const sourceBranch = normalizeBranchName(worktree.branch);
	if (sourceBranch === '-') {
		context.formatter.writeError({
			text: [`Worktree has no branch: ${worktreePath}`],
			data: {
				ok: false,
				command: 'worktree merge',
				error: {
					message: `Worktree has no branch: ${worktreePath}`,
				},
			},
		});
		return 1;
	}

	let targetBranch = context.parsedArgs.flags.target?.trim();
	if (!targetBranch) {
		targetBranch = worktree.gitStatus?.parentBranch || undefined;
	}
	if (!targetBranch) {
		try {
			const response = await fetchDaemonApi<{defaultBranch: string}>(
				context,
				'/api/branches/default',
			);
			targetBranch = response.defaultBranch || 'main';
		} catch {
			targetBranch = 'main';
		}
	}

	try {
		await postDaemonApi<{success: boolean}>(context, '/api/worktree/merge', {
			sourceBranch,
			targetBranch,
			useRebase: false,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.formatter.writeError({
			text: [`Failed to merge worktree: ${message}`],
			data: {
				ok: false,
				command: 'worktree merge',
				error: {message},
			},
		});
		return 1;
	}

	context.formatter.write({
		text: [
			`Merged ${sourceBranch} into ${targetBranch}`,
			`Worktree: ${worktreePath}`,
		],
		data: {
			ok: true,
			command: 'worktree merge',
			path: worktreePath,
			sourceBranch,
			targetBranch,
		},
	});
	return 0;
}

export async function runWorktreeCommand(
	context: CliCommandContext,
): Promise<number> {
	const action = context.parsedArgs.input[1] ?? 'list';

	if (action === 'create') {
		return runWorktreeCreateCommand(context);
	}

	if (action === 'list') {
		return runWorktreeListCommand(context);
	}

	if (action === 'delete') {
		return runWorktreeDeleteCommand(context);
	}

	if (action === 'merge') {
		return runWorktreeMergeCommand(context);
	}

	context.formatter.writeError({
		text: [
			`Unknown worktree command: ${action}`,
			'Available worktree commands:',
			'  argusdev worktree create [--branch <name>] [--project <path>] [--task <td-task-id>]',
			'  argusdev worktree list [--project <path>]',
			'  argusdev worktree delete <path>',
			'  argusdev worktree merge <path> [--target <branch>]',
		],
		data: {
			ok: false,
			command: 'worktree',
			error: {
				message: `Unknown worktree command: ${action}`,
				available: ['create', 'list', 'delete', 'merge'],
			},
		},
	});

	return 1;
}
