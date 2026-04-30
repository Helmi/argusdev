import type {Session, SessionState} from '../types/index.js';

type SessionStateMetadataSource = Pick<Session, 'stateMutex'>;
type SessionUpdatePayloadSource = Pick<Session, 'id' | 'stateMutex'>;
type ApiSessionCreatedAtSource = Pick<Session, 'id'> & {
	lastActivity?: Date;
};
type ApiSessionPayloadSource = Pick<
	Session,
	| 'id'
	| 'name'
	| 'worktreePath'
	| 'isActive'
	| 'agentId'
	| 'normalizedAgentType'
	| 'stateMutex'
	| 'process'
> &
	ApiSessionCreatedAtSource;

export interface SessionStateMetadata {
	state: SessionState;
	autoApprovalFailed: boolean;
	autoApprovalReason: string | undefined;
}

export function resolveSessionCreatedAtFromSource(
	session: ApiSessionCreatedAtSource,
): number {
	const idMatch = /^session-(\d+)-/.exec(session.id);
	if (idMatch) {
		const parsedMs = Number.parseInt(idMatch[1] || '', 10);
		if (Number.isFinite(parsedMs) && parsedMs > 0) {
			return Math.floor(parsedMs / 1000);
		}
	}

	const activityMs = session.lastActivity?.getTime();
	if (
		typeof activityMs === 'number' &&
		Number.isFinite(activityMs) &&
		activityMs > 0
	) {
		return Math.floor(activityMs / 1000);
	}

	return Math.floor(Date.now() / 1000);
}

export function resolveSessionStateMetadata(
	session: SessionStateMetadataSource,
): SessionStateMetadata {
	const snapshot = session.stateMutex.getSnapshot();
	return {
		state: snapshot.state,
		autoApprovalFailed: snapshot.autoApprovalFailed,
		autoApprovalReason: snapshot.autoApprovalReason,
	};
}

export function toSessionUpdatePayload(session: SessionUpdatePayloadSource): {
	id: string;
	state: SessionState;
	autoApprovalFailed: boolean;
	autoApprovalReason: string | undefined;
} {
	return {
		id: session.id,
		...resolveSessionStateMetadata(session),
	};
}

export function toApiSessionPayload(session: ApiSessionPayloadSource): {
	id: string;
	name: string | undefined;
	path: string;
	state: SessionState;
	createdAt: number;
	autoApprovalFailed: boolean;
	autoApprovalReason: string | undefined;
	isActive: boolean;
	agentId: string | undefined;
	normalizedAgentType: string | undefined;
	pid: number;
} {
	return {
		id: session.id,
		name: session.name,
		path: session.worktreePath,
		...resolveSessionStateMetadata(session),
		createdAt: resolveSessionCreatedAtFromSource(session),
		isActive: session.isActive,
		agentId: session.agentId,
		normalizedAgentType: session.normalizedAgentType,
		pid: session.process.pid,
	};
}
