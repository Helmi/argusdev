import type {Worktree} from './types';

export function normalizeTdBranchName(branch?: string): string {
	if (!branch) return '';
	return branch.replace(/^refs\/heads\//, '').trim();
}

export function worktreeBelongsToProject(
	worktreePath: string,
	projectPath: string,
): boolean {
	if (worktreePath.startsWith(projectPath)) return true;

	const projectName = projectPath.split('/').pop() || '';
	const parentDir = projectPath.split('/').slice(0, -1).join('/');
	if (!projectName || !parentDir) return false;

	if (worktreePath.includes(`/.worktrees/${projectName}/`)) return true;
	if (worktreePath.startsWith(`${parentDir}/${projectName}-`)) return true;
	if (worktreePath.startsWith(`${parentDir}/${projectName}/`)) return true;

	return false;
}

export function resolveProjectPathForWorktree(
	worktreePath: string,
	projectPaths: string[],
	hintedProjectPath?: string,
): string | undefined {
	const matchedProjectPath = projectPaths.find(projectPath =>
		worktreeBelongsToProject(worktreePath, projectPath),
	);
	if (matchedProjectPath) return matchedProjectPath;

	const normalizedHint = hintedProjectPath?.trim();
	if (normalizedHint && projectPaths.includes(normalizedHint)) {
		return normalizedHint;
	}

	return undefined;
}

function extractTdTaskId(value?: string): string {
	const normalized = normalizeTdBranchName(value).toLowerCase();
	const match = normalized.match(/td-[a-z0-9]+/);
	return match?.[0] || '';
}

function normalizeWorktreeSegment(value?: string): string {
	const normalized = normalizeTdBranchName(value).toLowerCase();
	return normalized
		.replace(/\//g, '-')
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function scoreWorktreeMatch(worktree: Worktree, issueBranch: string): number {
	const branch = normalizeTdBranchName(worktree.branch);
	const basename = worktree.path.split('/').pop() || '';
	const normalizedIssueBranch = normalizeWorktreeSegment(issueBranch);
	const normalizedBranch = normalizeWorktreeSegment(branch);
	const normalizedBasename = normalizeWorktreeSegment(basename);
	const issueTaskId = extractTdTaskId(issueBranch);
	const branchTaskId = extractTdTaskId(branch);
	const pathTaskId = extractTdTaskId(worktree.path);

	if (branch && branch === issueBranch) return 4;
	if (worktree.path.endsWith(`/${issueBranch}`)) return 3;
	if (
		normalizedIssueBranch &&
		(normalizedBranch === normalizedIssueBranch ||
			normalizedBasename === normalizedIssueBranch)
	) {
		return 2;
	}
	if (
		issueTaskId &&
		(issueTaskId === branchTaskId || issueTaskId === pathTaskId)
	) {
		return 1;
	}

	return 0;
}

function resolveBestCandidate(
	worktrees: Worktree[],
	issueBranch: string,
): string | undefined {
	const candidates = worktrees
		.map(worktree => ({
			worktree,
			score: scoreWorktreeMatch(worktree, issueBranch),
		}))
		.filter(candidate => candidate.score > 0)
		.sort((left, right) => {
			if (right.score !== left.score) return right.score - left.score;
			if (left.worktree.hasSession !== right.worktree.hasSession) {
				return Number(left.worktree.hasSession) - Number(right.worktree.hasSession);
			}
			return left.worktree.path.localeCompare(right.worktree.path);
		});

	return candidates[0]?.worktree.path;
}

export function resolveTdIssueWorktreePath(
	worktrees: Worktree[],
	createdBranch?: string,
	projectPath?: string,
): string | undefined {
	const issueBranch = normalizeTdBranchName(createdBranch);
	if (!issueBranch) return undefined;

	const eligibleWorktrees = worktrees.filter(worktree => {
		if (!projectPath) return true;
		return worktree.path !== projectPath;
	});

	if (!projectPath) {
		return resolveBestCandidate(eligibleWorktrees, issueBranch);
	}

	const projectWorktrees = eligibleWorktrees.filter(worktree =>
		worktreeBelongsToProject(worktree.path, projectPath),
	);
	const projectMatch = resolveBestCandidate(projectWorktrees, issueBranch);
	if (projectMatch) return projectMatch;

	return resolveBestCandidate(eligibleWorktrees, issueBranch);
}
