import {useState, useEffect, useCallback} from 'react';
import {useAppStore} from '@/lib/store';
import type {TdIssue} from '@/lib/types';
import {cn} from '@/lib/utils';
import {TaskDetailModal} from '@/components/TaskDetailModal';
import {
	ListTodo,
	Circle,
	CircleDot,
	CheckCircle2,
	PauseCircle,
	AlertCircle,
} from 'lucide-react';

const statusIcons: Record<string, typeof Circle> = {
	open: Circle,
	in_progress: CircleDot,
	in_review: PauseCircle,
	closed: CheckCircle2,
	blocked: AlertCircle,
};

const statusColors: Record<string, string> = {
	open: 'text-muted-foreground',
	in_progress: 'text-blue-500',
	in_review: 'text-purple-500',
	closed: 'text-green-500',
	blocked: 'text-red-500',
};

const priorityColors: Record<string, string> = {
	P0: 'text-red-500 font-bold',
	P1: 'text-orange-500',
	P2: 'text-muted-foreground',
	P3: 'text-muted-foreground/50',
};

interface TaskContextCardProps {
	worktreePath?: string;
}

export function TaskContextCard({worktreePath}: TaskContextCardProps) {
	const {tdStatus} = useAppStore();
	const [task, setTask] = useState<TdIssue | null>(null);
	const [loading, setLoading] = useState(false);
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

	const closeModal = useCallback(() => {
		setSelectedIssueId(null);
	}, []);

	// Fetch linked task for this worktree (by matching branch to created_branch)
	useEffect(() => {
		if (!worktreePath || !tdStatus?.projectState?.enabled) {
			setTask(null);
			return;
		}

		const fetchLinkedTask = async () => {
			setLoading(true);
			try {
				// Get all in-progress tasks and find one linked to this worktree
				const res = await fetch('/api/td/issues?status=in_progress', {
					credentials: 'include',
				});
				if (!res.ok) return;

				const data = await res.json();
				const issues: TdIssue[] = data.issues;

				// Try to match by created_branch or by worktree path containing the task's branch
				const folderName = worktreePath.split('/').pop() || '';
				const matched = issues.find(issue => {
					if (
						issue.created_branch &&
						worktreePath.includes(issue.created_branch)
					)
						return true;
					// Match by folder name containing issue ID
					if (folderName.includes(issue.id)) return true;
					return false;
				});

				if (matched) {
					setTask(matched);
				} else {
					setTask(null);
				}
			} catch {
				// Silent fail — td is optional
				setTask(null);
			} finally {
				setLoading(false);
			}
		};

		fetchLinkedTask();
	}, [worktreePath, tdStatus?.projectState?.enabled]);

	if (!tdStatus?.projectState?.enabled) {
		return null;
	}

	if (loading) {
		return (
			<div className="text-xs text-muted-foreground animate-pulse flex items-center gap-1.5">
				<ListTodo className="h-3 w-3" />
				<span>Loading task...</span>
			</div>
		);
	}

	if (!task) {
		return null;
	}

	const StatusIcon = statusIcons[task.status] || Circle;

	const handleOpenTask = () => {
		setSelectedIssueId(task.id);
	};

	return (
		<>
			<button
				onClick={handleOpenTask}
				type="button"
				className="flex w-full items-center gap-1.5 text-left group rounded-md p-1 -m-1 hover:bg-muted/40 transition-colors"
				title={`Open task ${task.id}`}
			>
				<StatusIcon
					className={cn('h-3 w-3 shrink-0', statusColors[task.status])}
				/>
				<span className="text-xs font-mono text-muted-foreground shrink-0">
					{task.id}
				</span>
				<span className="text-xs truncate flex-1">{task.title}</span>
				<span className={cn('text-xs shrink-0', priorityColors[task.priority])}>
					{task.priority}
				</span>
			</button>
			{selectedIssueId && (
				<TaskDetailModal issueId={selectedIssueId} onClose={closeModal} />
			)}
		</>
	);
}
