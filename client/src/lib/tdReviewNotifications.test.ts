import {describe, expect, it} from 'vitest';
import type {TdIssue} from './types';
import {
	mergeIncomingReviewNotifications,
	reconcileProjectReviewState,
	reconcileReviewNotifications,
} from './tdReviewNotifications';

function makeIssue(overrides: Partial<TdIssue>): TdIssue {
	return {
		id: 'td-1',
		title: 'Task',
		description: '',
		status: 'open',
		type: 'task',
		priority: 'P1',
		points: 2,
		labels: '',
		parent_id: '',
		acceptance: '',
		implementer_session: '',
		reviewer_session: '',
		created_at: '',
		updated_at: '',
		closed_at: null,
		deleted_at: null,
		minor: 0,
		created_branch: 'feature/td-1',
		creator_session: '',
		sprint: '',
		defer_until: null,
		due_date: null,
		defer_count: 0,
		...overrides,
	};
}

describe('tdReviewNotifications', () => {
	it('does not create notifications from fetched in_review tasks alone', () => {
		const result = reconcileReviewNotifications({
			issues: [makeIssue({id: 'td-1', status: 'in_review'})],
			previousNotifications: [],
			dismissedIds: [],
		});

		expect(result.notifications).toEqual([]);
	});

	it('retains notifications for tasks still in_review', () => {
		const result = reconcileReviewNotifications({
			issues: [makeIssue({id: 'td-1', status: 'in_review'})],
			previousNotifications: [{id: 'td-1', title: 'Task', priority: 'P1'}],
			dismissedIds: [],
		});

		expect(result.notifications).toEqual([
			{id: 'td-1', title: 'Task', priority: 'P1'},
		]);
	});

	it('keeps dismissed ids while task is still in_review', () => {
		const result = reconcileReviewNotifications({
			issues: [makeIssue({id: 'td-1', status: 'in_review'})],
			previousNotifications: [],
			dismissedIds: ['td-1'],
		});

		expect(result.dismissedIds).toEqual(['td-1']);
		expect(result.notifications).toEqual([]);
	});

	it('clears dismissed ids when task leaves in_review', () => {
		const result = reconcileReviewNotifications({
			issues: [makeIssue({id: 'td-1', status: 'in_progress'})],
			previousNotifications: [{id: 'td-1', title: 'Task', priority: 'P1'}],
			dismissedIds: ['td-1'],
		});

		expect(result.dismissedIds).toEqual([]);
		expect(result.notifications).toEqual([]);
	});

	it('re-surfaces task when it re-enters review after dismissal', () => {
		const firstPass = reconcileReviewNotifications({
			issues: [makeIssue({id: 'td-1', status: 'in_progress'})],
			previousNotifications: [],
			dismissedIds: ['td-1'],
		});
		const secondPass = reconcileReviewNotifications({
			issues: [makeIssue({id: 'td-1', status: 'in_review'})],
			previousNotifications: firstPass.notifications,
			dismissedIds: firstPass.dismissedIds,
		});

		expect(secondPass.notifications).toEqual([]);
		expect(secondPass.dismissedIds).toEqual([]);
	});

	it('ignores incoming socket notifications for dismissed tasks', () => {
		const result = mergeIncomingReviewNotifications(
			[{id: 'td-1', title: 'Task 1', priority: 'P1'}],
			[
				{id: 'td-1', title: 'Task 1', priority: 'P1'},
				{id: 'td-2', title: 'Task 2', priority: 'P0'},
			],
			['td-2'],
		);

		expect(result).toEqual([{id: 'td-1', title: 'Task 1', priority: 'P1'}]);
	});

	it('clears dismissed ids for background projects when review ids change', () => {
		const result = reconcileProjectReviewState({
			previousNotifications: [{id: 'td-1', title: 'Task 1', priority: 'P1'}],
			dismissedIds: ['td-1', 'td-2'],
			reviewIssueIds: ['td-3'],
		});

		expect(result.notifications).toEqual([]);
		expect(result.dismissedIds).toEqual([]);
	});
});
