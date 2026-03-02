import type {TdIssue, TdIssueWithChildren} from './types'

export interface TaskDetailTabCounts {
	overview: number
	activity: number
	details: number
}

export type ChildTaskGroup = 'needs-fix' | 'in_review' | 'open' | 'closed'

export interface GroupedChildren {
	'needs-fix': TdIssue[]
	in_review: TdIssue[]
	open: TdIssue[]
	closed: TdIssue[]
}

export function getChildGroup(child: TdIssue): ChildTaskGroup {
	if (child.status === 'closed') return 'closed'
	if (child.status === 'in_review') return 'in_review'
	if (child.status === 'in_progress') {
		// Check if this task was rejected (has reviewer_session set = was in review, now back in progress)
		if (child.reviewer_session) return 'needs-fix'
		// Also check for comments with rejection - but children don't have comments loaded
		// Fall back to treating in_progress without reviewer_session as "open" for starting
		return 'open'
	}
	return 'open'
}

export function groupChildrenByStatus(children: TdIssue[]): GroupedChildren {
	const grouped: GroupedChildren = {
		'needs-fix': [],
		in_review: [],
		open: [],
		closed: [],
	}
	for (const child of children) {
		const group = getChildGroup(child)
		grouped[group].push(child)
	}
	return grouped
}

export function parseAcceptanceCriteria(acceptance: string): string[] {
	return acceptance
		.split('\n')
		.map(item => item.replace(/^\s*[-*]\s*/, '').trim())
		.filter(Boolean)
}

export function getLinkedSessions(
	issue: Pick<TdIssue, 'implementer_session' | 'reviewer_session'>,
): Array<{label: string; id: string}> {
	return [
		{label: 'Implementer', id: issue.implementer_session},
		{label: 'Reviewer', id: issue.reviewer_session},
	]
		.map(entry => ({...entry, id: entry.id.trim()}))
		.filter(
			(entry): entry is {label: string; id: string} => entry.id.length > 0,
		)
}

function hasText(value: string | null | undefined): boolean {
	return typeof value === 'string' && value.trim().length > 0
}

function asArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : []
}

export function hasSchedulingDetails(issue: TdIssueWithChildren): boolean {
	return (
		hasText(issue.due_date) ||
		hasText(issue.defer_until) ||
		issue.points > 0 ||
		hasText(issue.sprint) ||
		issue.minor === 1 ||
		hasText(issue.created_branch) ||
		issue.defer_count > 0
	)
}

export function getTaskDetailLayoutCounts(
	issue: TdIssueWithChildren,
): TaskDetailTabCounts {
	const labels = issue.labels
		? issue.labels
				.split(',')
				.map(label => label.trim())
				.filter(Boolean)
		: []
	const acceptance = parseAcceptanceCriteria(issue.acceptance)
	const linkedSessions = getLinkedSessions(issue)
	const children = asArray<TdIssue>(issue.children)
	const handoffs = asArray(issue.handoffs)
	const comments = asArray((issue as {comments?: unknown}).comments)
	const files = asArray(issue.files)

	return {
		overview:
			(issue.description ? 1 : 0) +
			(acceptance.length > 0 ? 1 : 0) +
			(children.length > 0 ? 1 : 0) +
			(labels.length > 0 ? 1 : 0),
		activity:
			(linkedSessions.length > 0 ? 1 : 0) +
			(handoffs.length > 0 ? 1 : 0) +
			(comments.length > 0 ? 1 : 0),
		details: (files.length > 0 ? 1 : 0) + (hasSchedulingDetails(issue) ? 1 : 0) + 1,
	}
}
