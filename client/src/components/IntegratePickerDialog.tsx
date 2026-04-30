import {useState, useEffect} from 'react';
import {GitMerge} from 'lucide-react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {useAppStore} from '@/lib/store';
import {nudgeSession} from '@/lib/nudge';
import type {Worktree, Session} from '@/lib/types';

const DEFAULT_TEMPLATE = `Check for the unmerged work in worktree \`{{worktree.name}}\` (branch \`{{branch}}\`, parent \`{{parent}}\`). If the changes are reasonable and the merge is clean, integrate them — choose squash/rebase/merge per project conventions, write a sensible commit/PR body, and clean up the branch and worktree afterward when done. If anything is unclear or conflicts arise, stop and report.`;

function renderTemplate(
	template: string,
	vars: Record<string, string>,
): string {
	return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) =>
		key in vars ? vars[key]! : `{{${key}}}`,
	);
}

interface IntegratePickerDialogProps {
	session: Session;
	unmergedWorktrees: Worktree[];
	projectName: string;
	onClose: () => void;
}

export function IntegratePickerDialog({
	session,
	unmergedWorktrees,
	projectName,
	onClose,
}: IntegratePickerDialogProps) {
	const {setNudgePending} = useAppStore();

	const [selectedWorktreePath, setSelectedWorktreePath] = useState(
		unmergedWorktrees[0]?.path ?? '',
	);
	const [parentBranch, setParentBranch] = useState('');
	const [text, setText] = useState('');
	// Once the user has typed in the textarea, stop auto-regenerating from the
	// template — otherwise correcting the guessed parent branch (which is in
	// the template render deps) would wipe the user's edits.
	const [userEditedText, setUserEditedText] = useState(false);

	const selectedWorktree = unmergedWorktrees.find(
		w => w.path === selectedWorktreePath,
	);

	// Update parent branch when the user picks a different worktree. Reset
	// the user-edited flag so a freshly selected worktree starts from the
	// template.
	//
	// IMPORTANT: dep on `selectedWorktreePath` (string), NOT `selectedWorktree`
	// (object). The parent recomputes `unmergedWorktrees` on every poll/socket
	// refresh, so `unmergedWorktrees.find(...)` returns a fresh object identity
	// even when the user has not switched worktrees. Depending on the object
	// would re-fire this effect on every refresh and clobber the user's edits.
	useEffect(() => {
		if (!selectedWorktree) return;
		const parent =
			selectedWorktree.gitStatus?.parentBranch ?? '';
		setParentBranch(parent);
		setUserEditedText(false);
		// selectedWorktree is intentionally omitted from deps — see above.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedWorktreePath]);

	// Re-render template whenever inputs change, but only while the user has
	// not manually edited the text. After the first manual edit the textarea
	// is fully owned by the user — corrections to parentBranch must not wipe
	// the prompt. Dep on selectedWorktreePath (string) instead of the object
	// for the same poll-refresh reason as the reset effect above.
	useEffect(() => {
		if (!selectedWorktree) return;
		if (userEditedText) return;
		const branch = selectedWorktree.branch ?? '';
		const worktreeName =
			selectedWorktree.path.split('/').pop() ?? selectedWorktree.path;
		const vars: Record<string, string> = {
			'worktree.name': worktreeName,
			'worktree.path': selectedWorktree.path,
			branch,
			parent: parentBranch,
			'project.name': projectName,
		};
		setText(renderTemplate(DEFAULT_TEMPLATE, vars));
		// selectedWorktree is intentionally omitted — see the reset effect above.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedWorktreePath, parentBranch, projectName, userEditedText]);

	const isGuessed =
		selectedWorktree?.gitStatus?.parentBranchSource === 'guessed';

	const handleSend = () => {
		nudgeSession(session.id, text, {
			purpose: 'integrate',
			setNudgePending,
		});
		onClose();
	};

	return (
		<Dialog open onOpenChange={open => !open && onClose()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-sm">
						<GitMerge className="h-4 w-4" />
						Integrate worktree
					</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					{/* Worktree picker */}
					<div className="flex flex-col gap-1.5">
						<label className="text-xs font-medium text-muted-foreground">
							Worktree to integrate
						</label>
						<select
							className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
							value={selectedWorktreePath}
							onChange={e => setSelectedWorktreePath(e.target.value)}
						>
							{unmergedWorktrees.map(w => {
								const name = w.path.split('/').pop() ?? w.path;
								const branch = w.branch ? ` (${w.branch})` : '';
								const commits = w.gitStatus?.aheadCount ?? 0;
								return (
									<option key={w.path} value={w.path}>
										{name}{branch} — {commits} unmerged commit{commits !== 1 ? 's' : ''}
									</option>
								);
							})}
						</select>
					</div>

					{/* Parent branch (editable) */}
					<div className="flex flex-col gap-1.5">
						<label className="text-xs font-medium text-muted-foreground">
							Merge into (parent branch)
							{isGuessed && (
								<span className="ml-1.5 text-amber-400">— guessed, confirm</span>
							)}
						</label>
						<input
							type="text"
							className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
							value={parentBranch}
							onChange={e => setParentBranch(e.target.value)}
							placeholder="e.g. main"
						/>
					</div>

					{/* Prompt preview (editable) */}
					<div className="flex flex-col gap-1.5">
						<label className="text-xs font-medium text-muted-foreground">
							Nudge text (editable)
						</label>
						<textarea
							className="min-h-[120px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-ring"
							value={text}
							onChange={e => {
								setText(e.target.value);
								setUserEditedText(true);
							}}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button
						size="sm"
						disabled={!text.trim() || !parentBranch.trim()}
						onClick={handleSend}
					>
						Preview &amp; Send
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
