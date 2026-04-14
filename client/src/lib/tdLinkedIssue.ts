import type {TdIssue, Worktree} from './types';
import {resolveTdIssueWorktreePath} from './tdWorktreeResolver';

export const linkedTdIssueStatuses =
	'open,in_progress,in_review,blocked,closed';

export type TdWorkflowAction =
	| 'submit_review'
	| 'approve'
	| 'request_changes'
	| 'unblock';

export function findLinkedTdIssue(
	issues: TdIssue[],
	worktrees: Worktree[],
	worktreePath: string,
	projectPath?: string,
): TdIssue | null {
	const folderName = worktreePath.split('/').pop() || '';

	return (
		issues.find(issue => {
			const resolvedWorktreePath = resolveTdIssueWorktreePath(
				worktrees,
				issue.created_branch,
				projectPath,
			);
			if (resolvedWorktreePath === worktreePath) return true;

			const createdBranch = issue.created_branch?.trim();
			if (createdBranch && worktreePath.includes(createdBranch)) return true;
			if (folderName.includes(issue.id)) return true;

			return false;
		}) || null
	);
}

export function getTdWorkflowActions(status: string): TdWorkflowAction[] {
	if (status === 'open' || status === 'in_progress') {
		return ['submit_review'];
	}

	if (status === 'in_review') {
		return ['approve', 'request_changes'];
	}

	if (status === 'blocked') {
		return ['unblock'];
	}

	return [];
}
