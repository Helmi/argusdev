import {useAppStore} from '@/lib/store';
import {X, Eye, ListTodo} from 'lucide-react';
import {Button} from '@/components/ui/button';

export function TdReviewBanner() {
	const {
		tdReviewNotifications,
		dismissTdReviewNotification,
		dismissAllTdReviewNotifications,
		openConversationView,
	} = useAppStore();

	if (tdReviewNotifications.length === 0) return null;

	return (
		<div className="shrink-0 border-b border-border bg-purple-500/10 px-4 py-2">
			<div className="flex items-center gap-2">
				<ListTodo className="h-4 w-4 text-purple-400 shrink-0" />
				<span className="text-xs font-medium text-purple-400">
					{tdReviewNotifications.length === 1
						? '1 task ready for review'
						: `${tdReviewNotifications.length} tasks ready for review`}
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="h-6 px-2 text-xs text-purple-400 hover:text-purple-300"
					onClick={() => {
						const firstIssue = tdReviewNotifications[0];
						openConversationView({taskId: firstIssue?.id});
					}}
				>
					<Eye className="h-3 w-3 mr-1" />
					Open Queue
				</Button>
				<div className="flex-1" />
				<Button
					variant="ghost"
					size="icon"
					className="h-5 w-5 text-muted-foreground hover:text-foreground"
					onClick={dismissAllTdReviewNotifications}
				>
					<X className="h-3 w-3" />
				</Button>
			</div>
			{tdReviewNotifications.length <= 3 && (
				<div className="mt-1 space-y-0.5">
					{tdReviewNotifications.map(n => (
						<div
							key={n.id}
							className="flex items-center gap-2 text-xs text-muted-foreground"
						>
							<span className="font-mono text-xs">{n.id}</span>
							<span className="truncate">{n.title}</span>
							<span className="text-xs text-purple-400 shrink-0">
								{n.priority}
							</span>
							<Button
								variant="ghost"
								size="sm"
								className="h-5 px-1.5 text-xs text-purple-300 hover:text-purple-200"
								onClick={() => {
									openConversationView({taskId: n.id});
									dismissTdReviewNotification(n.id);
								}}
							>
								View
							</Button>
							<button
								className="ml-auto text-muted-foreground hover:text-foreground"
								onClick={() => dismissTdReviewNotification(n.id)}
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
