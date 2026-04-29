import {useState, useEffect, useCallback} from 'react';
import {apiFetch} from '@/lib/apiFetch';
import {Button} from '@/components/ui/button';
import {useAppStore} from '@/lib/store';
import type {TdIssue} from '@/lib/types';
import {
	findLinkedTdIssue,
	getTdWorkflowActions,
	linkedTdIssueStatuses,
} from '@/lib/tdLinkedIssue';
import {cn} from '@/lib/utils';
import {TaskDetailModal} from '@/components/TaskDetailModal';
import {resolveProjectPathForWorktree} from '@/lib/tdWorktreeResolver';
import {
	ListTodo,
	Circle,
	CircleDot,
	CheckCircle2,
	PauseCircle,
	AlertCircle,
	ExternalLink,
	Loader2,
	Send,
	RotateCcw,
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
	const {projects, tdStatus, worktrees} = useAppStore();
	const resolvedProjectPath = worktreePath
		? resolveProjectPathForWorktree(worktreePath, projects.map(p => p.path))
		: undefined;
	const [task, setTask] = useState<TdIssue | null>(null);
	const [loading, setLoading] = useState(false);
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [showCommentInput, setShowCommentInput] = useState(false);
	const [commentText, setCommentText] = useState('');

	const closeModal = useCallback(() => {
		setSelectedIssueId(null);
	}, []);

	const fetchTaskDetail = useCallback(async (issueId: string) => {
		try {
			const response = await apiFetch(`/api/td/issues/${issueId}`);
			if (!response.ok) {
				setTask(null);
				return;
			}

			const data = await response.json();
			setTask(data.issue || null);
		} catch {
			setTask(null);
		}
	}, []);

	// Fetch linked task for this worktree
	useEffect(() => {
		if (!worktreePath || !tdStatus?.projectState?.enabled) {
			setTask(null);
			setActionError(null);
			setShowCommentInput(false);
			setCommentText('');
			return;
		}

		let cancelled = false;

		const fetchLinkedTask = async () => {
			setLoading(true);
			setTask(null);
			setActionError(null);
			setShowCommentInput(false);
			setCommentText('');

			try {
				const res = await apiFetch(
					`/api/td/issues?status=${linkedTdIssueStatuses}`,
				);
				if (!res.ok) {
					if (!cancelled) {
						setTask(null);
					}
					return;
				}

				const data = await res.json();
				const issues: TdIssue[] = Array.isArray(data.issues) ? data.issues : [];
				const matched = findLinkedTdIssue(
					issues,
					worktrees,
					worktreePath,
					resolvedProjectPath,
				);

				if (cancelled) return;

				if (matched) {
					setTask(matched);
					return;
				}

				setTask(null);
			} catch {
				// Silent fail — td is optional
				if (!cancelled) {
					setTask(null);
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};

		fetchLinkedTask();
		return () => {
			cancelled = true;
		};
	}, [
		resolvedProjectPath,
		tdStatus?.projectState?.enabled,
		worktreePath,
		worktrees,
	]);

	const taskId = task?.id || '';
	const taskStatus = task?.status || '';
	const StatusIcon = statusIcons[taskStatus] || Circle;
	const workflowActions = getTdWorkflowActions(taskStatus);

	const handleOpenTask = () => {
		if (!taskId) return;
		setSelectedIssueId(taskId);
	};

	const runTaskAction = useCallback(
		async (action: 'review' | 'approve' | 'request-changes' | 'unblock') => {
			if (!taskId) return;

			setActionLoading(action);
			setActionError(null);

			try {
				const response = await apiFetch(`/api/td/issues/${taskId}/${action}`, {
					method: 'POST',
					headers:
						action === 'request-changes'
							? {'Content-Type': 'application/json'}
							: undefined,
					body:
						action === 'request-changes'
							? JSON.stringify({
									comment: commentText.trim() || undefined,
								})
							: undefined,
				});

				if (!response.ok) {
					const data = await response
						.json()
						.catch(() => ({error: 'Task action failed'}));
					setActionError(data.error || 'Task action failed');
					return;
				}

				await fetchTaskDetail(taskId);
				if (action === 'request-changes') {
					setShowCommentInput(false);
					setCommentText('');
				}
			} catch (error) {
				setActionError(
					error instanceof Error ? error.message : 'Task action failed',
				);
			} finally {
				setActionLoading(null);
			}
		},
		[commentText, fetchTaskDetail, taskId],
	);

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

	return (
		<>
			<section className="space-y-3 rounded-md border border-border bg-card/40 p-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0">
						<ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
							TD
						</span>
					</div>
					<span
						className={cn(
							'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
							statusColors[task.status],
						)}
					>
						<StatusIcon className="h-3 w-3 shrink-0" />
						{task.status.replace('_', ' ')}
					</span>
				</div>

				<div className="space-y-1 min-w-0">
					<div className="flex items-center gap-2 min-w-0">
						<span className="text-xs font-mono text-muted-foreground shrink-0">
							{task.id}
						</span>
						<span className={cn('text-xs shrink-0', priorityColors[task.priority])}>
							{task.priority}
						</span>
					</div>
					<button
						onClick={handleOpenTask}
						type="button"
						className="block w-full text-left text-sm font-medium hover:text-foreground/80 transition-colors"
						title={`Open task ${task.id}`}
					>
						{task.title}
					</button>
				</div>

				<div className="flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-xs"
						onClick={handleOpenTask}
					>
						<ExternalLink className="mr-1.5 h-3 w-3" />
						View task
					</Button>

					{workflowActions.includes('submit_review') && (
						<Button
							size="sm"
							className="h-7 text-xs"
							disabled={!!actionLoading}
							onClick={() => runTaskAction('review')}
						>
							{actionLoading === 'review' ? (
								<Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
							) : (
								<Send className="mr-1.5 h-3 w-3" />
							)}
							Submit for review
						</Button>
					)}

					{workflowActions.includes('approve') && (
						<Button
							size="sm"
							className="h-7 text-xs"
							disabled={!!actionLoading}
							onClick={() => runTaskAction('approve')}
						>
							{actionLoading === 'approve' ? (
								<Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
							) : (
								<CheckCircle2 className="mr-1.5 h-3 w-3" />
							)}
							Approve
						</Button>
					)}

					{workflowActions.includes('request_changes') && (
						<Button
							size="sm"
							variant="outline"
							className="h-7 text-xs"
							disabled={!!actionLoading}
							onClick={() => setShowCommentInput(open => !open)}
						>
							<RotateCcw className="mr-1.5 h-3 w-3" />
							Request changes
						</Button>
					)}

					{workflowActions.includes('unblock') && (
						<Button
							size="sm"
							className="h-7 text-xs"
							disabled={!!actionLoading}
							onClick={() => runTaskAction('unblock')}
						>
							{actionLoading === 'unblock' ? (
								<Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
							) : (
								<RotateCcw className="mr-1.5 h-3 w-3" />
							)}
							Unblock
						</Button>
					)}
				</div>

				{showCommentInput && workflowActions.includes('request_changes') && (
					<div className="space-y-2 rounded border border-border p-2">
						<textarea
							value={commentText}
							onChange={event => setCommentText(event.target.value)}
							placeholder="Describe what needs to change..."
							className="min-h-20 w-full rounded border border-border bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
						/>
						<div className="flex justify-end">
							<Button
								size="sm"
								variant="destructive"
								className="h-6 text-xs"
								disabled={!!actionLoading}
								onClick={() => runTaskAction('request-changes')}
							>
								{actionLoading === 'request-changes' ? (
									<Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
								) : null}
								Send back
							</Button>
						</div>
					</div>
				)}

				{actionError && (
					<div className="text-xs text-destructive">{actionError}</div>
				)}
			</section>
			{selectedIssueId && (
				<TaskDetailModal
					issueId={selectedIssueId}
					projectPath={resolvedProjectPath}
					onClose={closeModal}
					onRefresh={() => fetchTaskDetail(selectedIssueId)}
				/>
			)}
		</>
	);
}
