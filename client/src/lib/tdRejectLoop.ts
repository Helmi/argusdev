import type {TdIssue, Session} from './types';

export type RejectLoopPillType = 'rejected' | 're-review';

export interface RejectLoopItem {
	issue: TdIssue;
	pill: RejectLoopPillType;
	sessionId: string | null;
	sessionAlive: boolean;
	nudgeText: string;
	intent: 'work' | 'review';
}

/**
 * Fingerprint: status=open + implementer_session cleared + reviewer_session set.
 * td clears implementer_session on reject; reviewer_session stays as the rejector.
 */
function isRejected(issue: TdIssue): boolean {
	return (
		issue.status === 'open' &&
		!issue.implementer_session &&
		!!issue.reviewer_session
	);
}

/**
 * Fingerprint: status=in_review + reviewer_session set.
 */
function isReReview(issue: TdIssue): boolean {
	return issue.status === 'in_review' && !!issue.reviewer_session;
}

function buildRejectedNudge(issue: TdIssue, rejectionReason?: string): string {
	const base =
		`The reviewer rejected your work on task ${issue.id} ("${issue.title}"). ` +
		`Please check the rejection details via \`td show ${issue.id}\` and \`td comments ${issue.id}\`, ` +
		`then address the issues and resubmit.`;
	return rejectionReason
		? `${base}\n\nRejection reason: ${rejectionReason}`
		: base;
}

function buildReReviewNudge(issue: TdIssue): string {
	return (
		`The implementer pushed a fix for task ${issue.id} ("${issue.title}"). ` +
		`Please re-review via \`td show ${issue.id}\` and decide whether to approve ` +
		`(\`td approve ${issue.id}\`) or reject again (\`td reject ${issue.id} -m "reason"\`).`
	);
}

function findLinkedSession(
	issue: TdIssue,
	intent: 'work' | 'review',
	sessions: Session[],
): Session | null {
	const candidates = sessions.filter(
		s => s.tdTaskId === issue.id && s.isActive,
	);
	if (candidates.length === 0) return null;

	const byIntent =
		intent === 'review'
			? candidates.filter(s => s.name?.toLowerCase().includes('review'))
			: candidates.filter(s => !s.name?.toLowerCase().includes('review'));

	const pool = byIntent.length > 0 ? byIntent : candidates;
	return pool.reduce((best, s) =>
		(s.createdAt ?? 0) > (best.createdAt ?? 0) ? s : best,
	);
}

function findAnyLinkedSession(
	issue: TdIssue,
	intent: 'work' | 'review',
	sessions: Session[],
): Session | null {
	const candidates = sessions.filter(s => s.tdTaskId === issue.id);
	if (candidates.length === 0) return null;

	const byIntent =
		intent === 'review'
			? candidates.filter(s => s.name?.toLowerCase().includes('review'))
			: candidates.filter(s => !s.name?.toLowerCase().includes('review'));

	const pool = byIntent.length > 0 ? byIntent : candidates;
	return pool.reduce((best, s) =>
		(s.createdAt ?? 0) > (best.createdAt ?? 0) ? s : best,
	);
}

export function detectRejectLoopItems(
	issues: TdIssue[],
	sessions: Session[],
	rejectionReasonByIssueId?: Record<string, string | null>,
): RejectLoopItem[] {
	const items: RejectLoopItem[] = [];

	for (const issue of issues) {
		if (issue.deleted_at) continue;

		if (isRejected(issue)) {
			const intent = 'work';
			const liveSession = findLinkedSession(issue, intent, sessions);
			const anySession = liveSession ?? findAnyLinkedSession(issue, intent, sessions);
			const reason = rejectionReasonByIssueId?.[issue.id] ?? undefined;
			items.push({
				issue,
				pill: 'rejected',
				sessionId: anySession?.id ?? null,
				sessionAlive: !!liveSession,
				nudgeText: buildRejectedNudge(issue, reason),
				intent,
			});
		} else if (isReReview(issue)) {
			const intent = 'review';
			const liveSession = findLinkedSession(issue, intent, sessions);
			const anySession = liveSession ?? findAnyLinkedSession(issue, intent, sessions);
			items.push({
				issue,
				pill: 're-review',
				sessionId: anySession?.id ?? null,
				sessionAlive: !!liveSession,
				nudgeText: buildReReviewNudge(issue),
				intent,
			});
		}
	}

	return items;
}
