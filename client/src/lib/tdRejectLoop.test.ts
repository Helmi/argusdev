import {describe, it, expect} from 'vitest';
import {detectRejectLoopItems} from './tdRejectLoop';
import type {TdIssue, Session} from './types';

function makeIssue(overrides: Partial<TdIssue> = {}): TdIssue {
	return {
		id: 'td-test01',
		title: 'Test Issue',
		description: '',
		status: 'open',
		type: 'task',
		priority: 'P2',
		points: 0,
		labels: '',
		parent_id: '',
		acceptance: '',
		implementer_session: '',
		reviewer_session: '',
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
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

function makeSession(overrides: Partial<Session> = {}): Session {
	return {
		id: 'session-1',
		path: '/some/path',
		state: 'idle',
		isActive: true,
		createdAt: 1000,
		tdTaskId: null,
		intent: null,
		...overrides,
	};
}

describe('detectRejectLoopItems', () => {
	// Normal open task — no is_rejected flag → not a reject-loop state
	it('returns empty for normal open task without is_rejected', () => {
		const issue = makeIssue({status: 'open', is_rejected: false});
		expect(detectRejectLoopItems([issue], [])).toHaveLength(0);
	});

	// Normal open task with no is_rejected field at all (undefined)
	it('returns empty for open task with no is_rejected field', () => {
		const issue = makeIssue({status: 'open'});
		expect(detectRejectLoopItems([issue], [])).toHaveLength(0);
	});

	// Real td reject output: both sessions empty, is_rejected=true
	it('detects rejected state: open + is_rejected=true (both sessions empty)', () => {
		const issue = makeIssue({
			status: 'open',
			implementer_session: '',
			reviewer_session: '',
			is_rejected: true,
		});
		const items = detectRejectLoopItems([issue], []);
		expect(items).toHaveLength(1);
		expect(items[0]!.pill).toBe('rejected');
		expect(items[0]!.intent).toBe('work');
	});

	// First-time review (never rejected) — should NOT show re-review pill
	it('does not flag in_review without prior rejection', () => {
		const issue = makeIssue({status: 'in_review', is_rejected: false});
		expect(detectRejectLoopItems([issue], [])).toHaveLength(0);
	});

	// Re-review: in_review after a prior rejection (is_rejected=true in logs)
	it('detects re-review state: in_review + is_rejected=true', () => {
		const issue = makeIssue({
			status: 'in_review',
			implementer_session: 'ses_impl',
			reviewer_session: '',
			is_rejected: true,
		});
		const items = detectRejectLoopItems([issue], []);
		expect(items).toHaveLength(1);
		expect(items[0]!.pill).toBe('re-review');
		expect(items[0]!.intent).toBe('review');
	});

	it('skips deleted issues', () => {
		const issue = makeIssue({
			status: 'open',
			is_rejected: true,
			deleted_at: '2026-01-02T00:00:00Z',
		});
		expect(detectRejectLoopItems([issue], [])).toHaveLength(0);
	});

	it('sessionAlive=false when no matching live session', () => {
		const issue = makeIssue({id: 'td-abc123', status: 'open', is_rejected: true});
		const items = detectRejectLoopItems([issue], []);
		expect(items[0]!.sessionAlive).toBe(false);
		expect(items[0]!.sessionId).toBeNull();
	});

	it('sessionAlive=true when matching live work-intent session exists', () => {
		const issue = makeIssue({id: 'td-abc123', status: 'open', is_rejected: true});
		const session = makeSession({id: 'session-impl', tdTaskId: 'td-abc123', isActive: true, intent: 'work'});
		const items = detectRejectLoopItems([issue], [session]);
		expect(items[0]!.sessionAlive).toBe(true);
		expect(items[0]!.sessionId).toBe('session-impl');
	});

	it('sessionAlive=false for inactive session, but sessionId still returned', () => {
		const issue = makeIssue({id: 'td-abc123', status: 'open', is_rejected: true});
		const session = makeSession({id: 'session-old', tdTaskId: 'td-abc123', isActive: false, intent: 'work'});
		const items = detectRejectLoopItems([issue], [session]);
		expect(items[0]!.sessionAlive).toBe(false);
		expect(items[0]!.sessionId).toBe('session-old');
	});

	it('picks most recent session by createdAt', () => {
		const issue = makeIssue({id: 'td-abc123', status: 'open', is_rejected: true});
		const older = makeSession({id: 'session-old', tdTaskId: 'td-abc123', isActive: true, intent: 'work', createdAt: 1000});
		const newer = makeSession({id: 'session-new', tdTaskId: 'td-abc123', isActive: true, intent: 'work', createdAt: 2000});
		const items = detectRejectLoopItems([issue], [older, newer]);
		expect(items[0]!.sessionId).toBe('session-new');
	});

	it('prefers intent-matched session over any session', () => {
		const issue = makeIssue({id: 'td-abc123', status: 'open', is_rejected: true});
		const reviewSession = makeSession({id: 'session-review', tdTaskId: 'td-abc123', isActive: true, intent: 'review', createdAt: 3000});
		const workSession = makeSession({id: 'session-work', tdTaskId: 'td-abc123', isActive: true, intent: 'work', createdAt: 1000});
		const items = detectRejectLoopItems([issue], [reviewSession, workSession]);
		// rejected → wants 'work' intent session, even if older
		expect(items[0]!.sessionId).toBe('session-work');
	});

	it('includes rejection reason in nudge text when provided', () => {
		const issue = makeIssue({id: 'td-abc123', status: 'open', is_rejected: true});
		const items = detectRejectLoopItems([issue], [], {'td-abc123': 'Tests are missing'});
		expect(items[0]!.nudgeText).toContain('Tests are missing');
	});

	it('nudge text omits rejection reason when not provided', () => {
		const issue = makeIssue({id: 'td-abc123', status: 'open', is_rejected: true});
		const items = detectRejectLoopItems([issue], []);
		expect(items[0]!.nudgeText).not.toContain('Rejection reason');
	});

	it('re-review nudge text references approve and reject commands', () => {
		const issue = makeIssue({id: 'td-abc123', status: 'in_review', is_rejected: true});
		const items = detectRejectLoopItems([issue], []);
		expect(items[0]!.nudgeText).toContain('td approve');
		expect(items[0]!.nudgeText).toContain('td reject');
	});
});
