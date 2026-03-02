import type {TdIssue} from './types';

export type TaskLaunchIntent = 'work' | 'review' | 'fix';

export interface TaskPrimaryAction {
	label: string;
	intent: TaskLaunchIntent;
}

export function getTaskPrimaryAction(task: TdIssue): TaskPrimaryAction | null {
	if (task.status === 'in_review') {
		return {label: 'Start Review', intent: 'review'};
	}
	if (task.status === 'in_progress' && task.reviewer_session) {
		return {label: 'Start Fix', intent: 'fix'};
	}
	if (task.status !== 'closed') {
		return {label: 'Continue Work', intent: 'work'};
	}
	return null;
}
