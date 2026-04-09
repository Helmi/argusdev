import {useState, useEffect, useCallback, useRef} from 'react';
import {useAppStore, socket} from '@/lib/store';
import {apiFetch} from '@/lib/apiFetch';
import {useIsMobile} from '@/hooks/useIsMobile';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {StatusIndicator} from '@/components/StatusIndicator';
import {AgentIcon, getLegacyAgentIconProps} from '@/components/AgentIcon';
import {FileBrowser} from '@/components/FileBrowser';
import {mapSessionState, type ChangedFilesResponse} from '@/lib/types';
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
	Search,
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
	const [filesResponse, setFilesResponse] = useState<ChangedFilesResponse | null>(null);
	const [filesLoading, setFilesLoading] = useState(false);
	const [filesError, setFilesError] = useState<string | null>(null);
	const [fileSearch, setFileSearch] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const [showAll, setShowAll] = useState(false);

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

	// Abort controller for in-flight fetches
	const abortRef = useRef<AbortController | null>(null);

	// Fetch changed files function
	const fetchChangedFiles = useCallback(async () => {
		if (!session?.path) {
			setFilesResponse(null);
			return;
		}

		// Cancel any in-flight request
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		setFilesLoading(true);
		setFilesError(null);
		try {
			const params = new URLSearchParams({path: session.path});
			if (debouncedSearch) {
				params.set('search', debouncedSearch);
				params.set('limit', '5000');
			} else if (showAll) {
				params.set('limit', '5000');
			} else {
				params.set('limit', '200');
			}
			const response = await apiFetch(`/api/worktree/files?${params}`, {
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error('Failed to fetch changed files');
			}
			const data: ChangedFilesResponse = await response.json();
			setFilesResponse(data);
		} catch (err) {
			// Ignore aborted requests — a newer fetch is already in flight
			if (err instanceof DOMException && err.name === 'AbortError') return;
			// Keep existing data visible on transient errors (git lock contention etc.)
			setFilesError(err instanceof Error ? err.message : 'Unknown error');
		} finally {
			if (!controller.signal.aborted) {
				setFilesLoading(false);
			}
		}
	}, [session?.path, debouncedSearch, showAll]);

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
		setFileSearch('');
		setDebouncedSearch('');
		setShowAll(false);
	}, [session?.id]);

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => setDebouncedSearch(fileSearch), 300);
		return () => clearTimeout(timer);
	}, [fileSearch]);

	// Fetch on session change
	useEffect(() => {
		fetchChangedFiles();
	}, [fetchChangedFiles]);

	// Re-fetch when git status changes on disk (file watcher detects commits, staging, etc.)
	useEffect(() => {
		if (!session?.path) return;

		const handler = (data: {projectPath: string}) => {
			if (session.path.startsWith(data.projectPath)) {
				fetchChangedFiles();
			}
		};
		socket.on('git_status_changed', handler);
		return () => {
			socket.off('git_status_changed', handler);
		};
	}, [session?.path, fetchChangedFiles]);

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
						<button
							onClick={startRenameSession}
							className="group/rename flex items-center gap-1 min-w-0 text-left"
							title="Click to rename"
						>
							<span className="font-medium text-sm truncate">
								{session.name || formatName(session.path)}
							</span>
							<Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover/rename:opacity-100 transition-opacity" />
						</button>
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
						{(filesResponse?.summary.totalFiles ?? 0) > 0 && (
							<span className="ml-0.5 px-1 py-0 text-xs rounded-full bg-current/20 min-w-[14px] text-center">
								{filesResponse!.summary.totalFiles}
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
					{filesResponse && filesResponse.summary.totalFiles > 0 && (
						<div className="flex items-center gap-3 text-sm">
							<span className="text-green-500 font-mono">
								+{filesResponse.summary.totalAdditions}
							</span>
							<span className="text-red-500 font-mono">
								-{filesResponse.summary.totalDeletions}
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

					{/* Search input — shown when there are many files or list is truncated */}
					{((filesResponse?.summary.totalFiles ?? 0) > 20 || filesResponse?.truncated) && (
						<div className="relative">
							<Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
							<Input
								placeholder="Filter files..."
								value={fileSearch}
								onChange={e => {
									setFileSearch(e.target.value);
									setShowAll(false);
								}}
								className="h-6 text-xs pl-6"
							/>
						</div>
					)}

					{/* Changed files list */}
					{filesLoading ? (
						<div className="text-xs text-muted-foreground animate-pulse">
							Loading files...
						</div>
					) : filesError ? (
						<div className="text-xs text-destructive">{filesError}</div>
					) : filesResponse && filesResponse.files.length > 0 ? (
						<div className="space-y-1">
							{filesResponse.files.map(file => (
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
							{/* Truncation notice */}
							{filesResponse.truncated && (
								<div className="flex items-center justify-between text-xs text-muted-foreground px-1.5 py-1.5 border-t border-border mt-1">
									<span>
										Showing {filesResponse.files.length} of {filesResponse.total} files
									</span>
									<button
										className="text-accent hover:underline"
										onClick={() => setShowAll(true)}
									>
										Show all
									</button>
								</div>
							)}
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
			<div className="flex h-8 items-center justify-between border-b border-border px-2 shrink-0">
				<span className="text-xs font-medium text-muted-foreground">
					Session Details
				</span>
				<div className="flex items-center gap-0.5">
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
