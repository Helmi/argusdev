import type {Worktree} from './types';

export function normalizeTdBranchName(branch?: string): string {
	if (!branch) return '';
	return branch.replace(/^refs\/heads\//, '').trim();
}

function worktreeBelongsToProject(
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

export function resolveTdIssueWorktreePath(
	worktrees: Worktree[],
	createdBranch?: string,
	projectPath?: string,
): string | undefined {
	const issueBranch = normalizeTdBranchName(createdBranch);
	if (!issueBranch) return undefined;

	const candidates = worktrees.filter(worktree => {
		if (projectPath && !worktreeBelongsToProject(worktree.path, projectPath)) {
			return false;
		}
		// Never resolve to the project root itself — task worktrees are always
		// subdirectories or siblings, not the main checkout
		if (projectPath && worktree.path === projectPath) {
			return false;
		}
		const branch = normalizeTdBranchName(worktree.branch);
		return branch === issueBranch || worktree.path.endsWith(`/${issueBranch}`);
	});

	if (candidates.length === 0) return undefined;
	return (
		candidates.find(worktree => !worktree.hasSession)?.path ||
		candidates[0]?.path
	);
}
