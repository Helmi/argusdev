import {describe, expect, it} from 'vitest';
import type {Session} from '../types/index.js';
import {
	Mutex,
	createInitialSessionStateData,
	type SessionStateData,
} from '../utils/mutex.js';
import {
	toApiSessionPayload,
	toSessionUpdatePayload,
} from './sessionStateMetadata.js';

type SessionSnapshot = Pick<
	SessionStateData,
	'state' | 'autoApprovalFailed' | 'autoApprovalReason'
>;

type SessionLike = Pick<
	Session,
	| 'id'
	| 'name'
	| 'worktreePath'
	| 'isActive'
	| 'agentId'
	| 'normalizedAgentType'
	| 'stateMutex'
	| 'process'
>;

function createSession(
	overrides: Partial<SessionLike> = {},
	snapshotOverrides: Partial<SessionSnapshot> = {},
): SessionLike {
	return {
		id: 'session-1',
		name: 'Session 1',
		worktreePath: '/repo/.worktrees/feat',
		isActive: true,
		agentId: 'codex',
		normalizedAgentType: 'codex',
		process: {pid: 4321} as Session['process'],
		stateMutex: new Mutex({
			...createInitialSessionStateData(),
			state: 'idle',
			...snapshotOverrides,
		}),
		...overrides,
	};
}

describe('sessionStateMetadata', () => {
	it('maps HTTP session payload with auto-approval metadata', () => {
		const payload = toApiSessionPayload(
			createSession(
				{isActive: false},
				{
					state: 'pending_auto_approval',
					autoApprovalFailed: true,
					autoApprovalReason: 'Approval verifier denied',
				},
			),
		);

		expect(payload).toEqual({
			id: 'session-1',
			name: 'Session 1',
			path: '/repo/.worktrees/feat',
			createdAt: expect.any(Number),
			state: 'pending_auto_approval',
			autoApprovalFailed: true,
			autoApprovalReason: 'Approval verifier denied',
			isActive: false,
			agentId: 'codex',
			normalizedAgentType: 'codex',
			pid: 4321,
		});
	});

	it('surfaces normalizedAgentType for custom-wrapped profiles (td-b3a548)', () => {
		const payload = toApiSessionPayload(
			createSession({
				id: 'session-custom',
				agentId: 'my-claude',
				normalizedAgentType: 'claude',
			}),
		);

		expect(payload.agentId).toBe('my-claude');
		expect(payload.normalizedAgentType).toBe('claude');
	});

	it('maps websocket session_update payload with auto-approval metadata', () => {
		const payload = toSessionUpdatePayload(
			createSession(
				{id: 'session-2'},
				{
					state: 'waiting_input',
					autoApprovalFailed: false,
					autoApprovalReason: undefined,
				},
			),
		);

		expect(payload).toEqual({
			id: 'session-2',
			state: 'waiting_input',
			autoApprovalFailed: false,
			autoApprovalReason: undefined,
		});
	});
});
