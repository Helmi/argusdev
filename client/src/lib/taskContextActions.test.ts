import {describe, expect, it} from 'vitest';
import type {TdIssue} from './types';
import {getTaskPrimaryAction} from './taskContextActions';

function makeIssue(overrides: Partial<TdIssue>): TdIssue {
	return {
		id: 'td-123',
		title: 'Task',
		description: '',
		status: 'open',
		type: 'task',
		priority: 'P1',
		points: 3,
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
		created_branch: 'feature/td-123',
		creator_session: '',
		sprint: '',
		defer_until: null,
		due_date: null,
		defer_count: 0,
		...overrides,
	};
}

describe('taskContextActions', () => {
	it('returns review action for in_review tasks', () => {
		expect(getTaskPrimaryAction(makeIssue({status: 'in_review'}))).toEqual({
			label: 'Start Review',
			intent: 'review',
		});
	});

	it('returns fix action for rejected in-progress tasks', () => {
		expect(
			getTaskPrimaryAction(
				makeIssue({status: 'in_progress', reviewer_session: 'ses-123'}),
			),
		).toEqual({
			label: 'Start Fix',
			intent: 'fix',
		});
	});

	it('returns continue work for non-closed active tasks', () => {
		expect(getTaskPrimaryAction(makeIssue({status: 'open'}))).toEqual({
			label: 'Continue Work',
			intent: 'work',
		});
		expect(getTaskPrimaryAction(makeIssue({status: 'blocked'}))).toEqual({
			label: 'Continue Work',
			intent: 'work',
		});
	});

	it('returns null for closed tasks', () => {
		expect(getTaskPrimaryAction(makeIssue({status: 'closed'}))).toBeNull();
	});
});
