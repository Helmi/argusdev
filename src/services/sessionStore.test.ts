import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {existsSync, unlinkSync} from 'fs';
import path from 'path';
import {tmpdir} from 'os';
import {SessionStore} from './sessionStore.js';

vi.mock('../utils/logger.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock('../adapters/index.js', () => ({
	adapterRegistry: {
		getByAgentType: () => null,
	},
}));

describe('SessionStore', () => {
	const dbPath = path.join(
		tmpdir(),
		`argusdev-session-store-test-${process.pid}-${Date.now()}.db`,
	);
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore(dbPath);
	});

	afterEach(() => {
		store.close();
		for (const suffix of ['', '-shm', '-wal']) {
			const filePath = `${dbPath}${suffix}`;
			if (existsSync(filePath)) {
				unlinkSync(filePath);
			}
		}
	});

	it('creates and fetches session metadata', () => {
		store.createSessionRecord({
			id: 'session-1',
			agentProfileId: 'claude-max',
			agentProfileName: 'Claude Max',
			agentType: 'claude',
			agentOptions: {model: 'sonnet', yolo: true},
			worktreePath: '/tmp/worktree-a',
			branchName: 'feature/a',
			projectPath: '/tmp/project-a',
			tdTaskId: 'td-123',
			tdSessionId: 'ses_123456',
			sessionName: 'My Session',
			intent: 'work',
			createdAt: 1_720_000_000,
		});

		const stored = store.getSessionById('session-1');
		expect(stored).not.toBeNull();
		expect(stored?.agentProfileName).toBe('Claude Max');
		expect(stored?.agentType).toBe('claude');
		expect(stored?.agentOptions).toEqual({model: 'sonnet', yolo: true});
		expect(stored?.tdTaskId).toBe('td-123');
		expect(stored?.intent).toBe('work');
	});

	it('updates session name, link, and ended_at', () => {
		store.createSessionRecord({
			id: 'session-2',
			agentProfileId: 'codex',
			agentProfileName: 'Codex',
			agentType: 'codex',
			agentOptions: {},
			worktreePath: '/tmp/worktree-b',
			createdAt: 1_720_000_100,
		});

		store.updateSessionName('session-2', 'Renamed');
		store.updateAgentSessionLink(
			'session-2',
			'/tmp/sessions/rollout-abc.jsonl',
			'rollout-abc',
		);
		store.markSessionEnded('session-2', 1_720_000_200);
		store.markSessionResumed('session-2');

		const stored = store.getSessionById('session-2');
		expect(stored?.sessionName).toBe('Renamed');
		expect(stored?.agentSessionPath).toBe('/tmp/sessions/rollout-abc.jsonl');
		expect(stored?.agentSessionId).toBe('rollout-abc');
		expect(stored?.endedAt).toBeNull();
	});

	it('supports query helpers and filtering', () => {
		store.createSessionRecord({
			id: 'session-3',
			agentProfileId: 'claude',
			agentProfileName: 'Claude',
			agentType: 'claude',
			agentOptions: {},
			worktreePath: '/tmp/worktree-c',
			projectPath: '/tmp/project-c',
			tdTaskId: 'td-aaa',
			sessionName: 'Alpha',
			createdAt: 1_720_100_000,
		});

		store.createSessionRecord({
			id: 'session-4',
			agentProfileId: 'codex',
			agentProfileName: 'Codex',
			agentType: 'codex',
			agentOptions: {},
			worktreePath: '/tmp/worktree-d',
			projectPath: '/tmp/project-c',
			tdTaskId: 'td-bbb',
			sessionName: 'Beta',
			contentPreview: 'Investigate parser regression in auth middleware',
			createdAt: 1_720_200_000,
		});

		expect(store.queryByProject('/tmp/project-c')).toHaveLength(2);
		expect(store.queryByTask('td-aaa')).toHaveLength(1);
		expect(store.queryByWorktree('/tmp/worktree-c')).toHaveLength(1);
		expect(store.queryByDateRange(1_720_150_000, 1_720_250_000)).toHaveLength(
			1,
		);

		const filtered = store.querySessions({
			projectPath: '/tmp/project-c',
			agentType: 'codex',
			search: 'Beta',
		});
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.id).toBe('session-4');
		expect(
			store.querySessions({
				projectPath: '/tmp/project-c',
				search: 'parser regression',
			}),
		).toHaveLength(1);
		expect(store.countSessions({projectPath: '/tmp/project-c'})).toBe(2);
	});

	it('resolves latest session by td session id with optional task/project constraints', () => {
		store.createSessionRecord({
			id: 'session-a',
			agentProfileId: 'claude',
			agentProfileName: 'Claude',
			agentType: 'claude',
			agentOptions: {},
			worktreePath: '/tmp/worktree-a',
			projectPath: '/tmp/project-a',
			tdTaskId: 'td-1',
			tdSessionId: 'ses_link',
			createdAt: 1_720_000_100,
		});
		store.createSessionRecord({
			id: 'session-b',
			agentProfileId: 'claude',
			agentProfileName: 'Claude',
			agentType: 'claude',
			agentOptions: {},
			worktreePath: '/tmp/worktree-b',
			projectPath: '/tmp/project-a',
			tdTaskId: 'td-1',
			tdSessionId: 'ses_link',
			createdAt: 1_720_000_200,
		});
		store.createSessionRecord({
			id: 'session-c',
			agentProfileId: 'codex',
			agentProfileName: 'Codex',
			agentType: 'codex',
			agentOptions: {},
			worktreePath: '/tmp/worktree-c',
			projectPath: '/tmp/project-b',
			tdTaskId: 'td-2',
			tdSessionId: 'ses_link',
			createdAt: 1_720_000_300,
		});

		expect(
			store.getLatestByTdSessionId({
				tdSessionId: 'ses_link',
				tdTaskId: 'td-1',
				projectPath: '/tmp/project-a',
			})?.id,
		).toBe('session-b');
		expect(
			store.getLatestByTdSessionId({
				tdSessionId: 'ses_link',
				tdTaskId: 'td-1',
			})?.id,
		).toBe('session-b');
		expect(
			store.getLatestByTdSessionId({
				tdSessionId: 'ses_link',
				projectPath: '/tmp/project-b',
			})?.id,
		).toBe('session-c');
		expect(store.getLatestByTdSessionId({tdSessionId: 'ses_link'})?.id).toBe(
			'session-c',
		);
		expect(
			store.getLatestByTdSessionId({tdSessionId: 'ses_missing'}),
		).toBeNull();
	});

	it('resolves original work td session id for a task across fix rounds', () => {
		store.createSessionRecord({
			id: 'session-work-original',
			agentProfileId: 'codex',
			agentProfileName: 'Codex',
			agentType: 'codex',
			agentOptions: {},
			worktreePath: '/tmp/worktree-orig',
			projectPath: '/tmp/project-a',
			tdTaskId: 'td-42',
			tdSessionId: 'ses_impl',
			intent: 'work',
			createdAt: 1_720_000_100,
		});
		store.createSessionRecord({
			id: 'session-review',
			agentProfileId: 'codex',
			agentProfileName: 'Codex',
			agentType: 'codex',
			agentOptions: {},
			worktreePath: '/tmp/worktree-review',
			projectPath: '/tmp/project-a',
			tdTaskId: 'td-42',
			tdSessionId: 'ses_reviewer',
			intent: 'review',
			createdAt: 1_720_000_200,
		});
		store.createSessionRecord({
			id: 'session-fix-round-1',
			agentProfileId: 'codex',
			agentProfileName: 'Codex',
			agentType: 'codex',
			agentOptions: {},
			worktreePath: '/tmp/worktree-fix-1',
			projectPath: '/tmp/project-a',
			tdTaskId: 'td-42',
			tdSessionId: 'ses_fix_round_1',
			intent: 'work',
			createdAt: 1_720_000_300,
		});
		store.createSessionRecord({
			id: 'session-fix-round-2',
			agentProfileId: 'codex',
			agentProfileName: 'Codex',
			agentType: 'codex',
			agentOptions: {},
			worktreePath: '/tmp/worktree-fix-2',
			projectPath: '/tmp/project-a',
			tdTaskId: 'td-42',
			tdSessionId: 'ses_fix_round_2',
			intent: 'work',
			createdAt: 1_720_000_400,
		});
		store.createSessionRecord({
			id: 'session-other-project',
			agentProfileId: 'codex',
			agentProfileName: 'Codex',
			agentType: 'codex',
			agentOptions: {},
			worktreePath: '/tmp/worktree-other',
			projectPath: '/tmp/project-b',
			tdTaskId: 'td-42',
			tdSessionId: 'ses_other_project',
			intent: 'work',
			createdAt: 1_720_000_050,
		});

		expect(
			store.getOriginalWorkTdSessionId({
				tdTaskId: 'td-42',
				projectPath: '/tmp/project-a',
			}),
		).toBe('ses_impl');
		expect(
			store.getOriginalWorkTdSessionId({
				tdTaskId: 'td-42',
			}),
		).toBe('ses_other_project');
		expect(
			store.getOriginalWorkTdSessionId({
				tdTaskId: 'td-missing',
				projectPath: '/tmp/project-a',
			}),
		).toBeNull();
	});

	describe('maybeRescheduleAgentSessionDiscovery', () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		const createNullPathSession = (id: string) => {
			store.createSessionRecord({
				id,
				agentProfileId: 'claude-max',
				agentProfileName: 'Claude Max',
				agentType: 'claude',
				agentOptions: {},
				worktreePath: '/tmp/worktree-discovery',
				projectPath: '/tmp/project-discovery',
				intent: 'manual',
				createdAt: Math.floor(Date.now() / 1000),
			});
		};

		it('returns false when an active discovery timer already exists', () => {
			createNullPathSession('ses-active-timer');
			// Initial scheduling sets a live timer + cooldown stamp.
			store.scheduleAgentSessionDiscovery({
				sessionId: 'ses-active-timer',
				agentType: 'claude',
				worktreePath: '/tmp/worktree-discovery',
				createdAt: Math.floor(Date.now() / 1000),
			});

			expect(
				store.maybeRescheduleAgentSessionDiscovery('ses-active-timer'),
			).toBe(false);

			store.cancelAgentSessionDiscovery('ses-active-timer');
		});

		it('reschedules when no timer is active and the session is eligible', () => {
			createNullPathSession('ses-eligible');

			expect(store.maybeRescheduleAgentSessionDiscovery('ses-eligible')).toBe(
				true,
			);

			store.cancelAgentSessionDiscovery('ses-eligible');
		});

		it('returns false when the session has already ended', () => {
			createNullPathSession('ses-ended');
			store.markSessionEnded('ses-ended', Math.floor(Date.now() / 1000));

			expect(store.maybeRescheduleAgentSessionDiscovery('ses-ended')).toBe(
				false,
			);
		});

		it('returns false when agentSessionPath is already populated', () => {
			createNullPathSession('ses-has-path');
			store.updateAgentSessionLink(
				'ses-has-path',
				'/tmp/transcripts/ses-has-path.jsonl',
				'agent-internal-id',
			);

			expect(store.maybeRescheduleAgentSessionDiscovery('ses-has-path')).toBe(
				false,
			);
		});

		it('honors the cooldown window between attempts', () => {
			createNullPathSession('ses-cooldown');

			// First schedule consumes the cooldown stamp.
			expect(store.maybeRescheduleAgentSessionDiscovery('ses-cooldown')).toBe(
				true,
			);
			store.cancelAgentSessionDiscovery('ses-cooldown');

			// Within cooldown — must be rejected.
			vi.advanceTimersByTime(30_000);
			expect(store.maybeRescheduleAgentSessionDiscovery('ses-cooldown')).toBe(
				false,
			);

			// After cooldown — eligible again.
			vi.advanceTimersByTime(31_000);
			expect(store.maybeRescheduleAgentSessionDiscovery('ses-cooldown')).toBe(
				true,
			);
			store.cancelAgentSessionDiscovery('ses-cooldown');
		});

		it('returns false for an unknown session id', () => {
			expect(
				store.maybeRescheduleAgentSessionDiscovery('ses-does-not-exist'),
			).toBe(false);
		});
	});
});
