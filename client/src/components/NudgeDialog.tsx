import {useState, useEffect} from 'react';
import {MessageSquarePlus} from 'lucide-react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {useAppStore} from '@/lib/store';
import {sendNudge} from '@/lib/nudge';

export function NudgeDialog() {
	const {nudgePending, setNudgePending, sessions, socket} = useAppStore();
	const [text, setText] = useState('');

	// Sync textarea when a new nudge is opened
	useEffect(() => {
		if (nudgePending) setText(nudgePending.text);
	}, [nudgePending?.sessionId, nudgePending?.text]);

	if (!nudgePending) return null;

	const session = sessions.find(s => s.id === nudgePending.sessionId);
	const isIdle = session?.state === 'idle';
	const isExited = session && !session.isActive;
	const isBusy =
		session?.state === 'busy' || session?.state === 'waiting_input';

	// Only enable Send when session exists, is active, and idle
	const canSend = !!session && !isExited && isIdle;

	let blockReason: string | null = null;
	if (!session) blockReason = 'Session not found.';
	else if (isExited) blockReason = 'Session has exited.';
	else if (isBusy) blockReason = 'Agent is busy — wait for it to become idle, then retry.';
	else if (!isIdle) blockReason = 'Session is not idle.';

	const handleSend = () => {
		if (!canSend || !text) return;
		sendNudge(nudgePending.sessionId, text, socket);
		setNudgePending(null);
	};

	const handleClose = () => setNudgePending(null);

	return (
		<Dialog open onOpenChange={open => !open && handleClose()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-sm">
						<MessageSquarePlus className="h-4 w-4" />
						Nudge session
					</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-3">
					{session && (
						<p className="text-xs text-muted-foreground">
							{session.name ?? session.path}
						</p>
					)}

					<textarea
						className="min-h-[120px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
						value={text}
						onChange={e => setText(e.target.value)}
						placeholder="Type your message…"
						autoFocus
						onKeyDown={e => {
							// Cmd/Ctrl+Enter submits
							if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
								e.preventDefault();
								handleSend();
							}
						}}
					/>

					{blockReason && (
						<p className="text-xs text-muted-foreground">{blockReason}</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={handleClose}>
						Cancel
					</Button>
					<Button
						size="sm"
						disabled={!canSend || !text.trim()}
						onClick={handleSend}
					>
						Send
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
