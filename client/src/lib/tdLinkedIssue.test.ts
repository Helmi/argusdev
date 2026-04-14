import {describe, expect, it} from 'vitest';
import {findLinkedTdIssue, getTdWorkflowActions} from './tdLinkedIssue';
import type {TdIssue, Worktree} from './types';

function makeIssue(overrides: Partial<TdIssue> = {}): TdIssue {
	return {
		id: 'td-1',
		title: 'Task title',
		description: '',
		status: 'open',
		type: 'task',
		priority: 'P1',
		points: 0,
		labels: '',
		parent_id: '',
		acceptance: '',
		implementer_session: '',
		reviewer_session: '',
		created_at: '2026-04-14T00:00:00Z',
		updated_at: '2026-04-14T00:00:00Z',
		closed_at: null,
		deleted_at: null,
		minor: 0,
		created_branch: '',
		creator_session: '',
		sprint: '',
		defer_until: null,
		due_date: null,
		defer_count: 0,
		...overrides,
	};
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
	return {
		path: '/repo/.worktrees/feature/td-1-example',
		branch: 'feature/td-1-example',
		isMainWorktree: false,
		hasSession: true,
		...overrides,
	};
}

describe('tdLinkedIssue', () => {
	it('matches the linked issue via the shared worktree resolver', () => {
		const issue = makeIssue({id: 'td-1', created_branch: 'feature/td-1-example'});
		const linked = findLinkedTdIssue(
			[issue],
			[makeWorktree()],
			'/repo/.worktrees/feature/td-1-example',
			'/repo',
		);

		expect(linked?.id).toBe('td-1');
	});

	it('falls back to the worktree folder name when branch metadata is missing', () => {
		const issue = makeIssue({id: 'td-77b998'});
		const linked = findLinkedTdIssue(
			[issue],
			[],
			'/repo/.worktrees/argusdev/feature-td-77b998-integrate-td',
			'/repo',
		);

		expect(linked?.id).toBe('td-77b998');
	});

	it('returns the workflow actions expected by task status', () => {
		expect(getTdWorkflowActions('open')).toEqual(['submit_review']);
		expect(getTdWorkflowActions('in_progress')).toEqual(['submit_review']);
		expect(getTdWorkflowActions('in_review')).toEqual([
			'approve',
			'request_changes',
		]);
		expect(getTdWorkflowActions('blocked')).toEqual(['unblock']);
		expect(getTdWorkflowActions('closed')).toEqual([]);
	});
});
