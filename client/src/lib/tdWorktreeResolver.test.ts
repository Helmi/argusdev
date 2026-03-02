import {describe, expect, it} from 'vitest';
import type {Worktree} from './types';
import {
	normalizeTdBranchName,
	resolveTdIssueWorktreePath,
} from './tdWorktreeResolver';

function makeWorktree(
	path: string,
	branch?: string,
	hasSession = false,
): Worktree {
	return {
		path,
		branch,
		hasSession,
		isMainWorktree: false,
	};
}

describe('tdWorktreeResolver', () => {
	it('normalizes refs/heads prefixes', () => {
		expect(normalizeTdBranchName('refs/heads/feature/td-123')).toBe(
			'feature/td-123',
		);
		expect(normalizeTdBranchName(' feature/td-123 ')).toBe('feature/td-123');
		expect(normalizeTdBranchName('')).toBe('');
	});

	it('resolves by matching branch name and prefers worktrees without sessions', () => {
		const worktrees = [
			makeWorktree('/repo/.worktrees/feature-td-1-a', 'feature/td-1', true),
			makeWorktree(
				'/repo/.worktrees/feature-td-1-b',
				'refs/heads/feature/td-1',
				false,
			),
		];

		expect(resolveTdIssueWorktreePath(worktrees, 'feature/td-1')).toBe(
			'/repo/.worktrees/feature-td-1-b',
		);
	});

	it('falls back to path suffix match when branch metadata is missing', () => {
		const worktrees = [makeWorktree('/repo/.worktrees/feature/td-2')];

		expect(
			resolveTdIssueWorktreePath(worktrees, 'refs/heads/feature/td-2'),
		).toBe('/repo/.worktrees/feature/td-2');
	});

	it('scopes resolution to the selected project path when provided', () => {
		const worktrees = [
			makeWorktree('/projects/app-a/.worktrees/feature/td-3', 'feature/td-3'),
			makeWorktree('/projects/app-b/.worktrees/feature/td-3', 'feature/td-3'),
		];

		expect(
			resolveTdIssueWorktreePath(worktrees, 'feature/td-3', '/projects/app-b'),
		).toBe('/projects/app-b/.worktrees/feature/td-3');
	});

	it('returns undefined when no matching worktree exists', () => {
		const worktrees = [
			makeWorktree('/repo/.worktrees/feature/td-4', 'feature/td-4'),
		];

		expect(
			resolveTdIssueWorktreePath(worktrees, 'feature/td-5'),
		).toBeUndefined();
	});

	it('never resolves to the project root even if its branch matches', () => {
		// created_branch = 'main' is bad data but should not resolve to the project root
		const worktrees = [
			makeWorktree('/projects/app', 'main'),
			makeWorktree('/projects/.worktrees/app/task-td-99-foo', 'task/td-99-foo'),
		];

		expect(
			resolveTdIssueWorktreePath(worktrees, 'main', '/projects/app'),
		).toBeUndefined();
	});
});
