import type {TdIssue} from './types';

export interface TdReviewNotification {
	id: string;
	title: string;
	priority: string;
}

interface ReconcileInput {
	issues: TdIssue[];
	previousNotifications: TdReviewNotification[];
	dismissedIds: string[];
}

interface ReconcileOutput {
	notifications: TdReviewNotification[];
	dismissedIds: string[];
}

export function mergeIncomingReviewNotifications(
	previous: TdReviewNotification[],
	incoming: TdReviewNotification[],
	dismissedIds: string[],
): TdReviewNotification[] {
	const dismissed = new Set(dismissedIds);
	const existingIds = new Set(previous.map(notification => notification.id));
	const additions = incoming.filter(
		notification =>
			!existingIds.has(notification.id) && !dismissed.has(notification.id),
	);
	return additions.length > 0 ? [...previous, ...additions] : previous;
}

export function reconcileReviewNotifications({
	issues,
	previousNotifications,
	dismissedIds,
}: ReconcileInput): ReconcileOutput {
	const reviewReadyIssues = issues.filter(
		issue => issue.status === 'in_review',
	);
	const reviewReadyIds = new Set(reviewReadyIssues.map(issue => issue.id));
	const nextDismissedIds = dismissedIds.filter(id => reviewReadyIds.has(id));

	const retained = previousNotifications.filter(notification =>
		reviewReadyIds.has(notification.id),
	);
	const existingIds = new Set(retained.map(notification => notification.id));
	const additions = reviewReadyIssues
		.filter(
			issue =>
				!existingIds.has(issue.id) && !nextDismissedIds.includes(issue.id),
		)
		.map(issue => ({
			id: issue.id,
			title: issue.title,
			priority: issue.priority,
		}));

	return {
		notifications:
			additions.length > 0 ? [...retained, ...additions] : retained,
		dismissedIds: nextDismissedIds,
	};
}
