import {useState, useEffect, useCallback, useRef} from 'react';
import {useAppStore} from '@/lib/store';
import {useIsMobile} from '@/hooks/useIsMobile';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {StatusIndicator} from '@/components/StatusIndicator';
import {AgentIcon, getLegacyAgentIconProps} from '@/components/AgentIcon';
import {FileBrowser} from '@/components/FileBrowser';
import {mapSessionState, ChangedFile} from '@/lib/types';
import {TaskContextCard} from '@/components/TaskContextCard';
import {
	X,
	GitBranch,
	Copy,
	Check,
	FileText,
	FilePlus,
	FileX,
	FileEdit,
	FileQuestion,
	GitCommit,
	FolderTree,
	Pencil,
} from 'lucide-react';
import {cn, formatPath, copyToClipboard} from '@/lib/utils';

export function ContextSidebar() {
	const {
		sessions,
		worktrees,
		agents,
		contextSidebarSessionId,
		closeContextSidebar,
		openFileDiff,
		renameSession,
		sessionContextTabs,
		setSessionContextTab,
	} = useAppStore();

	const isMobile = useIsMobile();
	const [copied, setCopied] = useState(false);
	const [isRenamingSession, setIsRenamingSession] = useState(false);
	const [renameValue, setRenameValue] = useState('');
	const renameInputRef = useRef<HTMLInputElement>(null);
	const [changedFiles, setChangedFiles] = useState<ChangedFile[]>([]);
	const [filesLoading, setFilesLoading] = useState(false);
	const [filesError, setFilesError] = useState<string | null>(null);

	// Find the session
	const session = contextSidebarSessionId
		? sessions.find(s => s.id === contextSidebarSessionId)
		: null;

	// Find the worktree for this session
	const worktree = session
		? worktrees.find(w => w.path === session.path)
		: null;

	// Find agent config (for icon)
	const agentConfig = session?.agentId
		? agents.find(a => a.id === session.agentId)
		: undefined;
	const legacyIconProps = session?.agentId
		? getLegacyAgentIconProps(session.agentId)
		: undefined;
	const agentIcon = agentConfig?.icon || legacyIconProps?.icon;
	const agentIconColor = agentConfig?.iconColor || legacyIconProps?.iconColor;

	// Fetch changed files function
	const fetchChangedFiles = useCallback(async () => {
		if (!session?.path) {
			setChangedFiles([]);
			return;
		}

		setFilesLoading(true);
		setFilesError(null);
		try {
			const response = await fetch(
				`/api/worktree/files?path=${encodeURIComponent(session.path)}`,
			);
			if (!response.ok) {
				throw new Error('Failed to fetch changed files');
			}
			const files = await response.json();
			setChangedFiles(files);
		} catch (err) {
			setFilesError(err instanceof Error ? err.message : 'Unknown error');
			setChangedFiles([]);
		} finally {
			setFilesLoading(false);
		}
	}, [session?.path]);

	// Track previous session state to detect meaningful changes
	const prevSessionStateRef = useRef<string | null>(null);

	const formatName = useCallback(
		(path: string) => path.split('/').pop() || path,
		[],
	);

	const startRenameSession = useCallback(() => {
		if (!session) return;
		setRenameValue(session.name || formatName(session.path));
		setIsRenamingSession(true);
	}, [session, formatName]);

	const saveRenamedSession = useCallback(async () => {
		if (!session || !isRenamingSession) return;
		const success = await renameSession(session.id, renameValue.trim());
		if (success) {
			setIsRenamingSession(false);
		}
	}, [session, isRenamingSession, renameSession, renameValue]);

	const cancelRenameSession = useCallback(() => {
		setIsRenamingSession(false);
		setRenameValue('');
	}, []);

	const handleRenameKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				saveRenamedSession();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				cancelRenameSession();
			}
		},
		[saveRenamedSession, cancelRenameSession],
	);

	useEffect(() => {
		if (isRenamingSession && renameInputRef.current) {
			renameInputRef.current.focus();
			renameInputRef.current.select();
		}
	}, [isRenamingSession]);

	useEffect(() => {
		setIsRenamingSession(false);
		setRenameValue('');
	}, [session?.id]);

	// Fetch on session change
	useEffect(() => {
		fetchChangedFiles();
	}, [fetchChangedFiles]);

	// Re-fetch when session state changes (e.g., busy -> idle means agent may have modified files)
	// This replaces the expensive socket listener that fired on every update
	useEffect(() => {
		if (!session) return;

		// Only refetch if state actually changed (not on every render)
		if (
			prevSessionStateRef.current !== null &&
			prevSessionStateRef.current !== session.state
		) {
			// State changed - files may have been modified
			// Add a small delay to allow git operations to complete
			const timer = setTimeout(() => {
				fetchChangedFiles();
			}, 500);
			return () => clearTimeout(timer);
		}

		prevSessionStateRef.current = session.state;
	}, [session?.state, fetchChangedFiles, session]);

	if (!session) {
		return null;
	}

	// Handle path copy
	const handleCopyPath = async () => {
		const success = await copyToClipboard(session.path);
		if (success) {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	};

	// Content shared between mobile and desktop
	const mainContent = (
		<>
			{/* Session Info - Header area with status dot, icon, and name */}
			<div className="space-y-3">
				<div className="flex items-center gap-2 min-w-0">
					<StatusIndicator status={mapSessionState(session.state)} size="md" />
					<AgentIcon
						icon={agentIcon}
						iconColor={agentIconColor}
						className="h-5 w-5 shrink-0"
					/>
					{isRenamingSession ? (
						<Input
							ref={renameInputRef}
							value={renameValue}
							onChange={e => setRenameValue(e.target.value)}
							onKeyDown={handleRenameKeyDown}
							onBlur={saveRenamedSession}
							className="h-7 text-sm"
							aria-label={`Rename session ${session.name || formatName(session.path)}`}
						/>
					) : (
						<span className="font-medium text-sm truncate">
							{session.name || formatName(session.path)}
						</span>
					)}
				</div>

				{/* Compact location info below session name - no section header */}
				<div className="space-y-1.5 min-w-0">
					{worktree && (
						<div className="flex items-center gap-2 text-xs min-w-0">
							<GitBranch className="h-3.5 w-3.5 shrink-0 text-accent" />
							<span
								className={cn(
									'truncate',
									worktree.isMainWorktree && 'font-bold text-yellow-500',
								)}
							>
								{worktree.branch || formatName(worktree.path)}
							</span>
						</div>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								onClick={handleCopyPath}
								className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left min-w-0"
							>
								<span className="truncate flex-1 font-mono text-xs">
									{formatPath(session.path)}
								</span>
								{copied ? (
									<Check className="h-3 w-3 shrink-0 text-green-500" />
								) : (
									<Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
								)}
							</button>
						</TooltipTrigger>
						<TooltipContent side="bottom" className="max-w-xs">
							<p className="font-mono text-xs break-all">{session.path}</p>
							<p className="text-muted-foreground text-xs mt-1">
								Click to copy
							</p>
						</TooltipContent>
					</Tooltip>
				</div>
			</div>

			{/* Task Context (only when td is enabled) */}
			<TaskContextCard worktreePath={session.path} />

			{/* Divider */}
			<div className="border-t border-border" />

			{/* Tabbed Section: Changes / Files */}
			<Tabs
				value={sessionContextTabs[session.id] || 'changes'}
				onValueChange={value =>
					setSessionContextTab(session.id, value as 'changes' | 'files')
				}
				className="space-y-3"
			>
				{/* Custom styled tabs - segmented control look */}
				<TabsList className="grid w-full grid-cols-2 h-6 p-0 bg-transparent gap-2">
					<TabsTrigger
						value="changes"
						className={cn(
							'h-6 px-2 text-xs font-medium rounded transition-all duration-150',
							'flex items-center justify-center gap-1.5',
							'text-muted-foreground bg-transparent',
							'hover:text-muted-foreground hover:bg-muted/30',
							'data-[state=active]:bg-muted data-[state=active]:text-foreground',
						)}
					>
						<GitCommit className="h-3 w-3" />
						<span>Changes</span>
						{changedFiles.length > 0 && (
							<span className="ml-0.5 px-1 py-0 text-xs rounded-full bg-current/20 min-w-[14px] text-center">
								{changedFiles.length}
							</span>
						)}
					</TabsTrigger>
					<TabsTrigger
						value="files"
						className={cn(
							'h-6 px-2 text-xs font-medium rounded transition-all duration-150',
							'flex items-center justify-center gap-1.5',
							'text-muted-foreground bg-transparent',
							'hover:text-muted-foreground hover:bg-muted/30',
							'data-[state=active]:bg-muted data-[state=active]:text-foreground',
						)}
					>
						<FolderTree className="h-3 w-3" />
						<span>Files</span>
					</TabsTrigger>
				</TabsList>

				{/* Changes tab content */}
				<TabsContent value="changes" className="mt-0 space-y-2">
					{/* Git status summary */}
					{changedFiles.length > 0 && (
						<div className="flex items-center gap-3 text-sm">
							<span className="text-green-500 font-mono">
								+{changedFiles.reduce((sum, f) => sum + f.additions, 0)}
							</span>
							<span className="text-red-500 font-mono">
								-{changedFiles.reduce((sum, f) => sum + f.deletions, 0)}
							</span>
							{worktree?.gitStatus &&
								(worktree.gitStatus.aheadCount > 0 ||
									worktree.gitStatus.behindCount > 0) && (
									<>
										<span className="text-border">|</span>
										{worktree.gitStatus.aheadCount > 0 && (
											<span className="text-cyan-500 text-xs">
												↑{worktree.gitStatus.aheadCount}
											</span>
										)}
										{worktree.gitStatus.behindCount > 0 && (
											<span className="text-purple-500 text-xs">
												↓{worktree.gitStatus.behindCount}
											</span>
										)}
									</>
								)}
						</div>
					)}

					{/* Parent branch info */}
					{worktree?.gitStatus?.parentBranch && (
						<div className="text-xs text-muted-foreground">
							vs {worktree.gitStatus.parentBranch}
						</div>
					)}

					{/* Changed files list */}
					{filesLoading ? (
						<div className="text-xs text-muted-foreground animate-pulse">
							Loading files...
						</div>
					) : filesError ? (
						<div className="text-xs text-destructive">{filesError}</div>
					) : changedFiles.length > 0 ? (
						<div className="space-y-1">
							{changedFiles.map(file => (
								<button
									key={file.path}
									className="flex items-center gap-2 w-full text-left text-xs hover:bg-secondary/50 rounded px-1.5 py-1 transition-colors group"
									onClick={() => openFileDiff(session.id, file, session.path)}
								>
									{file.status === 'added' || file.status === 'untracked' ? (
										<FilePlus className="h-3 w-3 shrink-0 text-green-500" />
									) : file.status === 'deleted' ? (
										<FileX className="h-3 w-3 shrink-0 text-red-500" />
									) : file.status === 'modified' ? (
										<FileEdit className="h-3 w-3 shrink-0 text-yellow-500" />
									) : file.status === 'renamed' ? (
										<FileText className="h-3 w-3 shrink-0 text-blue-500" />
									) : (
										<FileQuestion className="h-3 w-3 shrink-0 text-muted-foreground" />
									)}
									<span className="truncate flex-1 font-mono text-xs">
										{file.path.split('/').pop()}
									</span>
									{(file.additions > 0 || file.deletions > 0) && (
										<span className="flex items-center gap-1 text-xs opacity-70 group-hover:opacity-100">
											{file.additions > 0 && (
												<span className="text-green-500">
													+{file.additions}
												</span>
											)}
											{file.deletions > 0 && (
												<span className="text-red-500">-{file.deletions}</span>
											)}
										</span>
									)}
								</button>
							))}
						</div>
					) : worktree?.gitStatusError ? (
						<div className="text-xs text-destructive">
							{worktree.gitStatusError}
						</div>
					) : (
						<div className="text-xs text-muted-foreground">
							No uncommitted changes
						</div>
					)}
				</TabsContent>

				{/* Files tab content */}
				<TabsContent value="files" className="mt-0 -mx-3 -mb-3">
					<FileBrowser worktreePath={session.path} />
				</TabsContent>
			</Tabs>
		</>
	);

	// Mobile: full-width overlay with backdrop
	if (isMobile) {
		return (
			<>
				{/* Backdrop */}
				<div
					className="fixed inset-0 top-9 bottom-7 z-40 bg-black/50 animate-in fade-in-0 duration-200"
					onClick={closeContextSidebar}
					aria-hidden="true"
				/>
				{/* Panel */}
				<aside
					className="fixed right-0 top-9 bottom-7 z-50 flex w-full max-w-sm flex-col border-l border-border bg-sidebar overflow-hidden animate-in slide-in-from-right duration-200"
					role="dialog"
					aria-modal="true"
					aria-label="Session details"
				>
					{/* Header */}
					<div className="flex h-11 items-center justify-between border-b border-border px-2 shrink-0">
						<span className="text-sm font-medium text-muted-foreground">
							Session Details
						</span>
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8"
								onClick={startRenameSession}
								title="Rename session"
							>
								<Pencil className="h-4 w-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8"
								onClick={closeContextSidebar}
							>
								<X className="h-4 w-4" />
							</Button>
						</div>
					</div>
					<ScrollArea className="flex-1 w-full">
						<div className="space-y-4 p-3 w-full max-w-full box-border">
							{mainContent}
						</div>
					</ScrollArea>
				</aside>
			</>
		);
	}

	// Desktop: static sidebar
	return (
		<aside className="flex w-64 flex-col border-l border-border bg-sidebar lg:w-72 xl:w-80 overflow-hidden">
			{/* Header */}
			<div className="flex h-7 items-center justify-between border-b border-border px-2 shrink-0">
				<span className="text-xs font-medium text-muted-foreground">
					Session Details
				</span>
				<div className="flex items-center gap-0.5">
					<Button
						variant="ghost"
						size="icon"
						className="h-5 w-5"
						onClick={startRenameSession}
						title="Rename session"
					>
						<Pencil className="h-3 w-3" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-5 w-5"
						onClick={closeContextSidebar}
					>
						<X className="h-3 w-3" />
					</Button>
				</div>
			</div>
			<ScrollArea className="flex-1 w-full">
				<div className="space-y-4 p-3 w-full max-w-full box-border">
					{mainContent}
				</div>
			</ScrollArea>
		</aside>
	);
}
