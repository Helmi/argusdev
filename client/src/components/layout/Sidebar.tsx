import {useState, useMemo, useEffect, useRef, useCallback} from 'react';
import {useAppStore} from '@/lib/store';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {ScrollArea} from '@/components/ui/scroll-area';
import {StatusIndicator} from '@/components/StatusIndicator';
import {AgentIcon} from '@/components/AgentIcon';
import {
	mapSessionState,
	type Project,
	type Worktree,
	type Session,
} from '@/lib/types';
import {cn} from '@/lib/utils';
import {Checkbox} from '@/components/ui/checkbox';
import {ConfirmDialog} from '@/components/ConfirmDialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
	DndContext,
	closestCenter,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import type {DragEndEvent} from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import {
	AlertTriangle,
	ArrowUpDown,
	ChevronsRight,
	ChevronDown,
	ChevronRight,
	FolderCog,
	FolderGit2,
	FolderPlus,
	GitBranch,
	GripVertical,
	ListTodo,
	MessageSquare,
	MoreVertical,
	PanelLeftClose,
	Pencil,
	Plus,
	RotateCcw,
	X,
} from 'lucide-react';
import {useIsMobile} from '@/hooks/useIsMobile';

const areSetsEqual = (a: Set<string>, b: Set<string>) => {
	if (a.size !== b.size) return false;
	for (const value of a) {
		if (!b.has(value)) return false;
	}
	return true;
};

import type {DraggableAttributes} from '@dnd-kit/core';
import type {SyntheticListenerMap} from '@dnd-kit/core/dist/hooks/utilities';

interface SortableProps {
	attributes: DraggableAttributes;
	listeners: SyntheticListenerMap | undefined;
}

function SortableProjectWrapper({
	id,
	children,
}: {
	id: string;
	children: (props: {sortableProps: SortableProps; style: React.CSSProperties}) => React.ReactNode;
}) {
	const {attributes, listeners, setNodeRef, transform, transition, isDragging} =
		useSortable({id});

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div ref={setNodeRef} style={style}>
			{children({sortableProps: {attributes, listeners}, style})}
		</div>
	);
}

export function Sidebar() {
	const {
		projects,
		worktrees,
		sessions,
		agents,
		currentProject,
		selectedSessions,
		sidebarOpen,
		sidebarCollapsed,
		expandSidebar,
		toggleSidebar,
		selectSession,
		openAddProject,
		openAddWorktree,
		openAddSession,
		openSettings,
		openTaskBoard,
		openConversationView,
		selectProject,
		updateProject,
		removeProject,
		renameSession,
		deleteWorktree,
		stopSession,
		restartSession,
	} = useAppStore();

	const isMobile = useIsMobile();
	const formatName = useCallback(
		(path: string) => path.split('/').pop() || path,
		[],
	);
	const ensureProjectSelected = useCallback(
		async (projectPath: string) => {
			if (currentProject?.path === projectPath) {
				return true;
			}
			return selectProject(projectPath);
		},
		[currentProject?.path, selectProject],
	);

	// Helper to get agent config by ID
	const getAgentById = (agentId?: string) => {
		if (!agentId) return undefined;
		return agents.find(a => a.id === agentId);
	};


	// Separate dialog states for different actions
	const [removeProjectDialog, setRemoveProjectDialog] = useState<{
		open: boolean;
		project: Project | null;
	}>({open: false, project: null});

	const [deleteWorktreeDialog, setDeleteWorktreeDialog] = useState<{
		open: boolean;
		worktree: Worktree | null;
		deleteBranch: boolean;
		projectPath: string | null;
	}>({open: false, worktree: null, deleteBranch: false, projectPath: null});

	const [stopSessionDialog, setStopSessionDialog] = useState<{
		open: boolean;
		session: Session | null;
	}>({open: false, session: null});

	const [restartSessionDialog, setRestartSessionDialog] = useState<{
		open: boolean;
		session: Session | null;
	}>({open: false, session: null});

	// Rename project state
	const [renamingProject, setRenamingProject] = useState<string | null>(null);
	const [projectRenameValue, setProjectRenameValue] = useState('');
	const projectRenameInputRef = useRef<HTMLInputElement>(null);

	// Rename session state
	const [renamingSession, setRenamingSession] = useState<string | null>(null);
	const [sessionRenameValue, setSessionRenameValue] = useState('');
	const sessionRenameInputRef = useRef<HTMLInputElement>(null);

	// Start renaming a project
	const startRenameProject = useCallback((project: Project) => {
		setRenamingSession(null);
		setSessionRenameValue('');
		setRenamingProject(project.path);
		setProjectRenameValue(project.name);
	}, []);

	// Save renamed project
	const saveRenamedProject = useCallback(async () => {
		if (!renamingProject || !projectRenameValue.trim()) {
			setRenamingProject(null);
			return;
		}
		await updateProject(renamingProject, projectRenameValue.trim());
		setRenamingProject(null);
	}, [renamingProject, projectRenameValue, updateProject]);

	// Cancel project rename
	const cancelProjectRename = useCallback(() => {
		setRenamingProject(null);
		setProjectRenameValue('');
	}, []);

	// Handle project rename input key events
	const handleProjectRenameKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				saveRenamedProject();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				cancelProjectRename();
			}
		},
		[saveRenamedProject, cancelProjectRename],
	);

	// Start renaming a session
	const startRenameSession = useCallback(
		(session: Session) => {
			setRenamingProject(null);
			setProjectRenameValue('');
			setRenamingSession(session.id);
			setSessionRenameValue(session.name || formatName(session.path));
		},
		[formatName],
	);

	// Save renamed session
	const saveRenamedSession = useCallback(async () => {
		if (!renamingSession) {
			return;
		}

		const success = await renameSession(
			renamingSession,
			sessionRenameValue.trim(),
		);
		if (success) {
			setRenamingSession(null);
			setSessionRenameValue('');
		}
	}, [renamingSession, renameSession, sessionRenameValue]);

	// Cancel session rename
	const cancelSessionRename = useCallback(() => {
		setRenamingSession(null);
		setSessionRenameValue('');
	}, []);

	// Handle session rename input key events
	const handleSessionRenameKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				saveRenamedSession();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				cancelSessionRename();
			}
		},
		[saveRenamedSession, cancelSessionRename],
	);

	// Auto-focus and select project rename input when it appears
	useEffect(() => {
		if (renamingProject && projectRenameInputRef.current) {
			projectRenameInputRef.current.focus();
			projectRenameInputRef.current.select();
		}
	}, [renamingProject]);

	// Auto-focus and select session rename input when it appears
	useEffect(() => {
		if (renamingSession && sessionRenameInputRef.current) {
			sessionRenameInputRef.current.focus();
			sessionRenameInputRef.current.select();
		}
	}, [renamingSession]);


	// Confirm remove project
	const confirmRemoveProject = (project: Project) => {
		setRemoveProjectDialog({open: true, project});
	};

	// Confirm delete worktree
	const confirmDeleteWorktree = (worktree: Worktree, projectPath: string) => {
		setDeleteWorktreeDialog({
			open: true,
			worktree,
			deleteBranch: false,
			projectPath,
		});
	};

	// Confirm stop session
	const confirmStopSession = (session: Session) => {
		setStopSessionDialog({open: true, session});
	};

	const confirmRestartSession = (session: Session) => {
		setRestartSessionDialog({open: true, session});
	};

	// Tree expansion state - persisted to localStorage
	const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
		try {
			const saved = localStorage.getItem('argusdev-expanded-projects');
			if (saved) {
				return new Set(JSON.parse(saved) as string[]);
			}
		} catch {
			// Ignore parse errors
		}
		// Default: expand all projects
		return new Set(projects.map(p => p.path));
	});
	const [expandedWorktrees, setExpandedWorktrees] = useState<Set<string>>(
		() => {
			try {
				const saved = localStorage.getItem('argusdev-expanded-worktrees');
				if (saved) {
					return new Set(JSON.parse(saved) as string[]);
				}
			} catch {
				// Ignore parse errors
			}
			// Default: expand all worktrees
			return new Set(worktrees.map(w => w.path));
		},
	);

	// Track known projects and worktrees to detect newly added ones
	const [knownProjectPaths, setKnownProjectPaths] = useState<Set<string>>(
		() => new Set(projects.map(p => p.path)),
	);
	const [knownWorktreePaths, setKnownWorktreePaths] = useState<Set<string>>(
		() => new Set(worktrees.map(w => w.path)),
	);
	const [knownSessionIds, setKnownSessionIds] = useState<Set<string>>(
		new Set(),
	);
	const [sessionTrackingInitialized, setSessionTrackingInitialized] =
		useState(false);

	// Persist expanded state to localStorage
	useEffect(() => {
		localStorage.setItem(
			'argusdev-expanded-projects',
			JSON.stringify([...expandedProjects]),
		);
	}, [expandedProjects]);

	useEffect(() => {
		localStorage.setItem(
			'argusdev-expanded-worktrees',
			JSON.stringify([...expandedWorktrees]),
		);
	}, [expandedWorktrees]);

	// Consolidated auto-expansion effect with debouncing
	// Handles new projects/worktrees and only expands for newly created sessions
	// after initial session tracking has completed.
	useEffect(() => {
		const timer = setTimeout(() => {
			const newExpandedProjects = new Set(expandedProjects);
			const newExpandedWorktrees = new Set(expandedWorktrees);
			let projectsChanged = false;
			let worktreesChanged = false;

			// 1. Handle new/initial projects
			const currentProjectPaths = new Set(projects.map(p => p.path));
			const newProjects = projects.filter(p => !knownProjectPaths.has(p.path));
			const hasSavedProjectState =
				localStorage.getItem('argusdev-expanded-projects') !== null;

			if (
				!hasSavedProjectState &&
				projects.length > 0 &&
				knownProjectPaths.size === 0
			) {
				// Initial load with no saved state - expand all
				projects.forEach(p => newExpandedProjects.add(p.path));
				projectsChanged = true;
			} else if (newProjects.length > 0) {
				// Auto-expand newly added projects
				newProjects.forEach(p => newExpandedProjects.add(p.path));
				projectsChanged = true;
			}

			// 2. Handle new/initial worktrees
			const currentWorktreePaths = new Set(worktrees.map(w => w.path));
			const newWorktrees = worktrees.filter(
				w => !knownWorktreePaths.has(w.path),
			);
			const hasSavedWorktreeState =
				localStorage.getItem('argusdev-expanded-worktrees') !== null;

			if (
				!hasSavedWorktreeState &&
				worktrees.length > 0 &&
				knownWorktreePaths.size === 0
			) {
				// Initial load with no saved state - expand all
				worktrees.forEach(w => newExpandedWorktrees.add(w.path));
				worktreesChanged = true;
			} else if (newWorktrees.length > 0) {
				// Auto-expand newly added worktrees
				newWorktrees.forEach(w => newExpandedWorktrees.add(w.path));
				worktreesChanged = true;
			}

			// 3. Auto-expand only for newly added sessions (not every update)
			const currentSessionIds = new Set(sessions.map(s => s.id));
			if (!sessionTrackingInitialized) {
				setSessionTrackingInitialized(true);
			} else {
				const newSessions = sessions.filter(s => !knownSessionIds.has(s.id));

				if (newSessions.length > 0) {
					const newSessionWorktreePaths = new Set(newSessions.map(s => s.path));

					// Expand worktrees for newly created sessions
					newSessionWorktreePaths.forEach(path => {
						if (!newExpandedWorktrees.has(path)) {
							newExpandedWorktrees.add(path);
							worktreesChanged = true;
						}
					});

					// Expand projects containing those worktrees
					newSessionWorktreePaths.forEach(wtPath => {
						for (const project of projects) {
							const projectName = project.path.split('/').pop() || '';
							if (
								wtPath.startsWith(project.path) ||
								wtPath.includes(`/.worktrees/${projectName}/`) ||
								wtPath.startsWith(
									`${project.path.split('/').slice(0, -1).join('/')}/${projectName}-`,
								) ||
								wtPath.startsWith(
									`${project.path.split('/').slice(0, -1).join('/')}/${projectName}/`,
								)
							) {
								if (!newExpandedProjects.has(project.path)) {
									newExpandedProjects.add(project.path);
									projectsChanged = true;
								}
								break;
							}
						}
					});
				}
			}

			// Batch state updates
			if (projectsChanged) {
				setExpandedProjects(newExpandedProjects);
			}
			if (worktreesChanged) {
				setExpandedWorktrees(newExpandedWorktrees);
			}

			// Update known paths
			if (!areSetsEqual(knownProjectPaths, currentProjectPaths)) {
				setKnownProjectPaths(currentProjectPaths);
			}
			if (!areSetsEqual(knownWorktreePaths, currentWorktreePaths)) {
				setKnownWorktreePaths(currentWorktreePaths);
			}
			if (!areSetsEqual(knownSessionIds, currentSessionIds)) {
				setKnownSessionIds(currentSessionIds);
			}
		}, 50); // Small debounce to batch updates

		return () => clearTimeout(timer);
	}, [
		projects,
		worktrees,
		sessions,
		knownProjectPaths,
		knownWorktreePaths,
		knownSessionIds,
		sessionTrackingInitialized,
		expandedProjects,
		expandedWorktrees,
	]);

	// Toggle worktree expansion
	const toggleWorktree = (path: string) => {
		setExpandedWorktrees(prev => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	// Toggle project expansion
	const toggleProject = (path: string) => {
		setExpandedProjects(prev => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	};

	// Reorder mode
	const [reorderMode, setReorderMode] = useState(false);
	const savedExpandedRef = useRef<Set<string> | null>(null);

	// Custom project order (persisted to localStorage)
	const [projectOrder, setProjectOrder] = useState<string[]>(() => {
		try {
			const saved = localStorage.getItem('argusdev-project-order');
			return saved ? (JSON.parse(saved) as string[]) : [];
		} catch {
			return [];
		}
	});
	useEffect(() => {
		if (projectOrder.length > 0) {
			localStorage.setItem(
				'argusdev-project-order',
				JSON.stringify(projectOrder),
			);
		}
	}, [projectOrder]);

	const toggleReorderMode = () => {
		if (!reorderMode) {
			savedExpandedRef.current = new Set(expandedProjects);
			setExpandedProjects(new Set());
		} else {
			if (savedExpandedRef.current) {
				setExpandedProjects(savedExpandedRef.current);
				savedExpandedRef.current = null;
			}
		}
		setReorderMode(prev => !prev);
	};

	// dnd-kit sensors
	const sensors = useSensors(
		useSensor(PointerSensor, {activationConstraint: {distance: 5}}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const {active, over} = event;
		if (!over || active.id === over.id) return;
		const ordered = filteredData.projects;
		const oldIndex = ordered.findIndex(p => p.path === active.id);
		const newIndex = ordered.findIndex(p => p.path === over.id);
		if (oldIndex === -1 || newIndex === -1) return;
		const reordered = [...ordered];
		const [moved] = reordered.splice(oldIndex, 1);
		reordered.splice(newIndex, 0, moved!);
		setProjectOrder(reordered.map(p => p.path));
	};

	// Apply custom order to projects
	const filteredData = useMemo(() => {
		let ordered = [...projects];
		if (projectOrder.length > 0) {
			const orderMap = new Map(projectOrder.map((path, i) => [path, i]));
			ordered.sort((a, b) => {
				const ai = orderMap.get(a.path) ?? Number.MAX_SAFE_INTEGER;
				const bi = orderMap.get(b.path) ?? Number.MAX_SAFE_INTEGER;
				if (ai !== bi) return ai - bi;
				return a.name.localeCompare(b.name, undefined, {sensitivity: 'base'});
			});
		} else {
			ordered.sort((a, b) =>
				a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}),
			);
		}
		return {projects: ordered, worktrees, sessions};
	}, [projects, worktrees, sessions, projectOrder]);

	// Helper to get sessions for a worktree
	const getSessionsForWorktree = (worktreePath: string) => {
		return filteredData.sessions.filter(s => s.path === worktreePath);
	};

	// Helper to get worktrees for a project
	// Worktrees can be:
	// 1. Under the project path (main worktree or nested .worktrees/)
	// 2. In ~/.worktrees/projectName/ (global worktree location)
	// 3. Sibling directories with project name prefix (../{project}-{branch} pattern)
	//
	// The backend should ideally return project association with each worktree,
	// but for now we use path-based heuristics.
	const getWorktreesForProject = (projectPath: string) => {
		const projectName = projectPath.split('/').pop() || '';
		const parentDir = projectPath.split('/').slice(0, -1).join('/');

		return filteredData.worktrees.filter(w => {
			// Main worktree or nested under project
			if (w.path.startsWith(projectPath)) return true;

			// Global worktree location: ~/.worktrees/projectName/
			if (w.path.includes(`/.worktrees/${projectName}/`)) return true;

			// Sibling worktree with project name prefix: ../{project}-{branch}
			if (w.path.startsWith(`${parentDir}/${projectName}-`)) return true;

			// Sibling directory with project name: ../{project}/{branch}
			if (w.path.startsWith(`${parentDir}/${projectName}/`)) return true;

			// Handle legacy {project} placeholder in path (corrupted data)
			if (w.path.includes('/.worktrees/{project}/')) return false;

			return false;
		});
	};

	// Handle session click
	const handleSessionClick = (sessionId: string) => {
		selectSession(sessionId);
		// Auto-close sidebar on mobile after session selection
		if (isMobile) {
			toggleSidebar();
		}
	};

	if (!sidebarOpen) return null;

	// Collapsed sidebar (icon-only mode)
	if (sidebarCollapsed) {
		return (
			<aside className="flex h-full w-10 flex-col border-r border-border bg-sidebar">
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-full rounded-none border-b border-border"
					onClick={expandSidebar}
				>
					<ChevronsRight className="h-3.5 w-3.5" />
				</Button>
				<ScrollArea className="flex-1">
					<div className="flex flex-col items-center gap-1 py-2">
						{projects.map(project => (
							<Button
								key={project.path}
								variant="ghost"
								size="icon"
								className="h-7 w-7"
								title={project.name}
							>
								<FolderGit2 className="h-3.5 w-3.5" />
							</Button>
						))}
					</div>
				</ScrollArea>
			</aside>
		);
	}

	// Expanded sidebar
	return (
		<aside className="flex h-full w-56 flex-col border-r border-border bg-sidebar lg:w-64 overflow-hidden">
			{/* Action bar */}
			<div className="flex h-8 items-center gap-1 px-2 border-b border-border">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className="h-6 px-2 gap-1.5 text-xs"
							title="Add new..."
						>
							<Plus className="h-3 w-3" />
							<span className="hidden lg:inline">New</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="text-xs">
						<DropdownMenuItem
							onClick={() => openAddSession()}
							className="text-xs"
						>
							<Plus className="h-3 w-3 mr-2" />
							New Session
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => openAddWorktree()}
							className="text-xs"
						>
							<GitBranch className="h-3 w-3 mr-2" />
							New Worktree
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={openAddProject} className="text-xs">
							<FolderPlus className="h-3 w-3 mr-2" />
							Add Project
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>

				<div className="flex-1" />

				{projects.length > 1 && (
					<Button
						variant="ghost"
						size="icon"
						className={cn(
							'h-6 w-6 shrink-0',
							reorderMode && 'bg-muted text-foreground',
						)}
						onClick={toggleReorderMode}
						title={reorderMode ? 'Done reordering' : 'Reorder projects'}
					>
						<ArrowUpDown className="h-3.5 w-3.5" />
					</Button>
				)}

				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 shrink-0 md:hidden"
					onClick={toggleSidebar}
					title="Close sidebar"
				>
					<PanelLeftClose className="h-3.5 w-3.5" />
				</Button>
			</div>

			{/* Tree content */}
			<ScrollArea className="flex-1">
				<div className="py-1">
					{(() => {
						const projectList = filteredData.projects.map((project, projectIndex) => {
						const projectWorktrees = getWorktreesForProject(project.path);
						const isCurrentProject = currentProject?.path === project.path;
						const isInvalid = project.isValid === false;

						const renderProject = (sortableProps?: SortableProps) => (
							<div
								key={project.path}
								className={cn(projectIndex > 0 && 'mt-2')}
							>
								{/* Project header - prominent separator */}
								<ContextMenu>
									<ContextMenuTrigger asChild>
										<div
											className={cn(
												'group flex w-full min-w-0 items-center gap-2 px-2 py-2 text-sm cursor-pointer',
												'bg-muted/50 hover:bg-muted transition-colors',
												isCurrentProject && 'bg-muted',
												isMobile && 'min-h-[44px]',
											)}
											onClick={() => {
												if (!reorderMode && renamingProject !== project.path) {
													toggleProject(project.path);
												}
											}}
										>
											{reorderMode ? (
												<span className="touch-none cursor-grab" {...sortableProps?.attributes} {...sortableProps?.listeners}>
													<GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
												</span>
											) : expandedProjects.has(project.path) ? (
												<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
											) : (
												<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
											)}
											{renamingProject === project.path ? (
												<Input
													ref={projectRenameInputRef}
													value={projectRenameValue}
													onChange={e => setProjectRenameValue(e.target.value)}
													onKeyDown={handleProjectRenameKeyDown}
													onBlur={saveRenamedProject}
													onClick={e => e.stopPropagation()}
													className="h-6 flex-1 px-1 py-0 text-sm font-medium"
													aria-label={`Rename project ${project.name}`}
												/>
											) : (
												<span className="truncate font-medium flex-1 text-left">
													{project.name}
												</span>
											)}
											{isInvalid && (
												<span
													className="shrink-0 text-yellow-600"
													title={`Invalid project path: ${project.path}`}
												>
													<AlertTriangle className="h-4 w-4" />
												</span>
											)}
											{/* Visible menu button - always on mobile, hover on desktop */}
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<div
														role="button"
														className={cn(
															'p-1 -m-1 rounded hover:bg-secondary/80 transition-colors',
															isMobile
																? 'opacity-100'
																: 'opacity-0 group-hover:opacity-100',
														)}
														onClick={e => e.stopPropagation()}
													>
														<MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
													</div>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end" className="text-xs">
													{isInvalid && (
														<>
															<DropdownMenuItem
																disabled
																className="text-yellow-600"
															>
																<AlertTriangle className="h-3.5 w-3.5 mr-2" />
																Invalid path
															</DropdownMenuItem>
															<DropdownMenuSeparator />
														</>
													)}
													{project.tdEnabled && (
														<DropdownMenuItem
															onClick={async () => {
																const selected = await ensureProjectSelected(
																	project.path,
																);
																if (!selected) return;
																openTaskBoard();
															}}
															disabled={isInvalid}
														>
															<ListTodo className="h-3.5 w-3.5 mr-2" />
															Task Board
														</DropdownMenuItem>
													)}
													<DropdownMenuItem
														onClick={async () => {
															const selected = await ensureProjectSelected(
																project.path,
															);
															if (!selected) return;
															openConversationView();
														}}
														disabled={isInvalid}
													>
														<MessageSquare className="h-3.5 w-3.5 mr-2" />
														Conversations
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() => openAddWorktree(project.path)}
														disabled={isInvalid}
													>
														<GitBranch className="h-3.5 w-3.5 mr-2" />
														New Worktree
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() =>
															openAddSession(undefined, project.path)
														}
														disabled={isInvalid}
													>
														<Plus className="h-3.5 w-3.5 mr-2" />
														New Session
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														onClick={() => startRenameProject(project)}
													>
														<Pencil className="h-3.5 w-3.5 mr-2" />
														Rename
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={async () => {
															const selected = await ensureProjectSelected(
																project.path,
															);
															if (!selected) return;
															openSettings('project');
														}}
														disabled={isInvalid}
													>
														<FolderCog className="h-3.5 w-3.5 mr-2" />
														Project Settings
													</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem
														className="text-destructive focus:text-destructive"
														onClick={() => confirmRemoveProject(project)}
													>
														<X className="h-3.5 w-3.5 mr-2" />
														Remove Project
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
									</ContextMenuTrigger>
									<ContextMenuContent>
										{isInvalid && (
											<>
												<ContextMenuItem disabled className="text-yellow-600">
													<AlertTriangle className="h-3.5 w-3.5 mr-2" />
													Invalid path
												</ContextMenuItem>
												<ContextMenuSeparator />
											</>
										)}
										{project.tdEnabled && (
											<ContextMenuItem
												onClick={async () => {
													const selected = await ensureProjectSelected(
														project.path,
													);
													if (!selected) return;
													openTaskBoard();
												}}
												disabled={isInvalid}
											>
												<ListTodo className="h-3.5 w-3.5 mr-2" />
												Task Board
											</ContextMenuItem>
										)}
										<ContextMenuItem
											onClick={async () => {
												const selected = await ensureProjectSelected(
													project.path,
												);
												if (!selected) return;
												openConversationView();
											}}
											disabled={isInvalid}
										>
											<MessageSquare className="h-3.5 w-3.5 mr-2" />
											Conversations
										</ContextMenuItem>
										<ContextMenuItem
											onClick={() => openAddWorktree(project.path)}
											disabled={isInvalid}
										>
											<GitBranch className="h-3.5 w-3.5 mr-2" />
											New Worktree
										</ContextMenuItem>
										<ContextMenuItem
											onClick={() => openAddSession(undefined, project.path)}
											disabled={isInvalid}
										>
											<Plus className="h-3.5 w-3.5 mr-2" />
											New Session
										</ContextMenuItem>
										<ContextMenuSeparator />
										<ContextMenuItem
											onClick={() => startRenameProject(project)}
										>
											<Pencil className="h-3.5 w-3.5 mr-2" />
											Rename
										</ContextMenuItem>
										<ContextMenuItem
											onClick={async () => {
												const selected = await ensureProjectSelected(
													project.path,
												);
												if (!selected) return;
												openSettings('project');
											}}
											disabled={isInvalid}
										>
											<FolderCog className="h-3.5 w-3.5 mr-2" />
											Project Settings
										</ContextMenuItem>
										<ContextMenuSeparator />
										<ContextMenuItem
											destructive
											onClick={() => confirmRemoveProject(project)}
										>
											<X className="h-3.5 w-3.5 mr-2" />
											Remove Project
										</ContextMenuItem>
									</ContextMenuContent>
								</ContextMenu>

								{/* Worktrees */}
								{expandedProjects.has(project.path) && <div className="py-1 min-w-0">
									{projectWorktrees.length === 0 ? (
										<div className="px-3 py-2 text-xs text-muted-foreground italic">
											No worktrees
										</div>
									) : (
										projectWorktrees.map(worktree => {
											const worktreeSessions = getSessionsForWorktree(
												worktree.path,
											);
											const isWorktreeExpanded = expandedWorktrees.has(
												worktree.path,
											);

											return (
												<div key={worktree.path}>
													{/* Worktree row with context menu */}
													<ContextMenu>
														<ContextMenuTrigger asChild>
															<button
																onClick={() => toggleWorktree(worktree.path)}
																className={cn(
																	'group flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors',
																	isMobile && 'min-h-[44px]',
																)}
															>
																{isWorktreeExpanded ? (
																	<ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
																) : (
																	<ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
																)}
																<GitBranch
																	className={cn(
																		'h-3.5 w-3.5 shrink-0',
																		worktree.isMainWorktree
																			? 'text-accent'
																			: 'text-muted-foreground',
																	)}
																/>
																<span className="truncate flex-1 text-left text-muted-foreground">
																	{worktree.branch || formatName(worktree.path)}
																</span>
																{/* Visible menu button */}
																<DropdownMenu>
																	<DropdownMenuTrigger asChild>
																		<div
																			role="button"
																			className={cn(
																				'p-1 -m-1 rounded hover:bg-secondary/80 transition-colors',
																				isMobile
																					? 'opacity-100'
																					: 'opacity-0 group-hover:opacity-100',
																			)}
																			onClick={e => e.stopPropagation()}
																		>
																			<MoreVertical className="h-3 w-3 text-muted-foreground" />
																		</div>
																	</DropdownMenuTrigger>
																	<DropdownMenuContent
																		align="end"
																		className="text-xs"
																	>
																		<DropdownMenuItem
																			onClick={() =>
																				openAddSession(worktree.path)
																			}
																		>
																			<Plus className="h-3.5 w-3.5 mr-2" />
																			New Session
																		</DropdownMenuItem>
																		<DropdownMenuSeparator />
																		<DropdownMenuItem
																			className="text-destructive focus:text-destructive"
																			onClick={() =>
																				confirmDeleteWorktree(
																					worktree,
																					project.path,
																				)
																			}
																			disabled={worktree.isMainWorktree}
																		>
																			<X className="h-3.5 w-3.5 mr-2" />
																			Delete Worktree
																		</DropdownMenuItem>
																	</DropdownMenuContent>
																</DropdownMenu>
															</button>
														</ContextMenuTrigger>
														<ContextMenuContent>
															<ContextMenuItem
																onClick={() => openAddSession(worktree.path)}
															>
																<Plus className="h-3.5 w-3.5 mr-2" />
																New Session
															</ContextMenuItem>
															<ContextMenuSeparator />
															<ContextMenuItem
																destructive
																onClick={() =>
																	confirmDeleteWorktree(worktree, project.path)
																}
																disabled={worktree.isMainWorktree}
															>
																<X className="h-3.5 w-3.5 mr-2" />
																Delete Worktree
															</ContextMenuItem>
														</ContextMenuContent>
													</ContextMenu>

													{/* Sessions */}
													{isWorktreeExpanded &&
														worktreeSessions.length > 0 && (
															<div className="py-0.5 pl-3 min-w-0">
																{worktreeSessions.map(session => {
																	const isSelected = selectedSessions.includes(
																		session.id,
																	);
																	const agent = getAgentById(session.agentId);

																	return (
																		<ContextMenu key={session.id}>
																			<ContextMenuTrigger asChild>
																				<div
																					className={cn(
																						'group relative flex min-w-0 items-center gap-2 pl-2 pr-3 py-1.5 cursor-pointer rounded-l transition-colors',
																						isSelected
																							? 'bg-primary/10'
																							: 'hover:bg-secondary/50',
																						isMobile && 'min-h-[44px]',
																					)}
																					onClick={() => {
																						if (
																							renamingSession !== session.id
																						) {
																							handleSessionClick(session.id);
																						}
																					}}
																				>
																					{/* Status indicator and agent icon */}
																					<StatusIndicator
																						status={mapSessionState(
																							session.state,
																						)}
																						size="sm"
																					/>
																					<AgentIcon
																						icon={agent?.icon}
																						iconColor={agent?.iconColor}
																						className="h-4 w-4 shrink-0"
																					/>
																					{renamingSession === session.id ? (
																						<Input
																							ref={sessionRenameInputRef}
																							value={sessionRenameValue}
																							onChange={e =>
																								setSessionRenameValue(
																									e.target.value,
																								)
																							}
																							onKeyDown={
																								handleSessionRenameKeyDown
																							}
																							onBlur={saveRenamedSession}
																							onClick={e => e.stopPropagation()}
																							className="h-6 flex-1 px-1 py-0 text-sm"
																							aria-label={`Rename session ${session.name || formatName(session.path)}`}
																						/>
																					) : (
																						<span
																							className={cn(
																								'min-w-0 flex-1 truncate text-sm',
																								isSelected
																									? 'text-primary font-medium'
																									: 'text-foreground',
																							)}
																						>
																							{session.name ||
																								formatName(session.path)}
																						</span>
																					)}
																					{/* Visible menu button */}
																					<DropdownMenu>
																						<DropdownMenuTrigger asChild>
																							<div
																								role="button"
																								className={cn(
																									'p-1 -m-1 rounded hover:bg-secondary/80 transition-colors z-10',
																									isMobile
																										? 'opacity-100'
																										: 'opacity-0 group-hover:opacity-100',
																								)}
																								onClick={e =>
																									e.stopPropagation()
																								}
																							>
																								<MoreVertical className="h-3 w-3 text-muted-foreground" />
																							</div>
																						</DropdownMenuTrigger>
																						<DropdownMenuContent
																							align="end"
																							className="text-xs"
																						>
																							<DropdownMenuItem
																								onClick={() =>
																									selectSession(session.id)
																								}
																							>
																								View Terminal
																							</DropdownMenuItem>
																							<DropdownMenuItem
																								onClick={() =>
																									startRenameSession(session)
																								}
																							>
																								<Pencil className="h-3.5 w-3.5 mr-2" />
																								Rename
																							</DropdownMenuItem>
																							<DropdownMenuItem
																								onClick={() =>
																									confirmRestartSession(session)
																								}
																							>
																								<RotateCcw className="h-3.5 w-3.5 mr-2" />
																								Restart Session
																							</DropdownMenuItem>
																							<DropdownMenuSeparator />
																							<DropdownMenuItem
																								className="text-destructive focus:text-destructive"
																								onClick={() =>
																									confirmStopSession(session)
																								}
																							>
																								<X className="h-3.5 w-3.5 mr-2" />
																								Stop Session
																							</DropdownMenuItem>
																						</DropdownMenuContent>
																					</DropdownMenu>
																					{/* Selection indicator - subtle bar on right */}
																					<div
																						className={cn(
																							'absolute right-0 top-1 bottom-1 w-[3px] rounded-full transition-all duration-150',
																							isSelected
																								? 'bg-primary'
																								: 'bg-transparent group-hover:bg-muted-foreground/30',
																						)}
																					/>
																				</div>
																			</ContextMenuTrigger>
																			<ContextMenuContent>
																				<ContextMenuItem
																					onClick={() =>
																						selectSession(session.id)
																					}
																				>
																					View Terminal
																				</ContextMenuItem>
																				<ContextMenuItem
																					onClick={() =>
																						startRenameSession(session)
																					}
																				>
																					<Pencil className="h-3.5 w-3.5 mr-2" />
																					Rename
																				</ContextMenuItem>
																				<ContextMenuItem
																					onClick={() =>
																						confirmRestartSession(session)
																					}
																				>
																					<RotateCcw className="h-3.5 w-3.5 mr-2" />
																					Restart Session
																				</ContextMenuItem>
																				<ContextMenuSeparator />
																				<ContextMenuItem
																					destructive
																					onClick={() =>
																						confirmStopSession(session)
																					}
																				>
																					<X className="h-3.5 w-3.5 mr-2" />
																					Stop Session
																				</ContextMenuItem>
																			</ContextMenuContent>
																		</ContextMenu>
																	);
																})}
															</div>
														)}
												</div>
											);
										})
									)}
								</div>}
							</div>
						);

						if (reorderMode) {
							return (
								<SortableProjectWrapper key={project.path} id={project.path}>
									{({sortableProps}) => renderProject(sortableProps)}
								</SortableProjectWrapper>
							);
						}

						return renderProject();
					});

						if (reorderMode) {
							return (
								<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
									<SortableContext items={filteredData.projects.map(p => p.path)} strategy={verticalListSortingStrategy}>
										{projectList}
									</SortableContext>
								</DndContext>
							);
						}
						return projectList;
					})()}

					{/* Show message if no projects */}
					{filteredData.projects.length === 0 && (
						<div className="px-4 py-8 text-center text-xs text-muted-foreground">
							No projects added yet
						</div>
					)}
				</div>
			</ScrollArea>

			{/* Remove Project Dialog */}
			<ConfirmDialog
				open={removeProjectDialog.open}
				onOpenChange={open => setRemoveProjectDialog(prev => ({...prev, open}))}
				title="Remove Project"
				description={`Remove "${removeProjectDialog.project?.name}" from ArgusDev? This doesn't delete any files.`}
				confirmLabel="Remove"
				variant="destructive"
				onConfirm={() => {
					if (removeProjectDialog.project) {
						removeProject(removeProjectDialog.project.path);
					}
				}}
			/>

			{/* Delete Worktree Dialog */}
			<ConfirmDialog
				open={deleteWorktreeDialog.open}
				onOpenChange={open =>
					setDeleteWorktreeDialog(prev => ({...prev, open}))
				}
				title="Delete Worktree"
				description={`Delete worktree for branch "${deleteWorktreeDialog.worktree?.branch || deleteWorktreeDialog.worktree?.path.split('/').pop()}"? This removes the directory.`}
				confirmLabel="Delete"
				variant="destructive"
				onConfirm={() => {
					if (deleteWorktreeDialog.worktree) {
						deleteWorktree(
							deleteWorktreeDialog.worktree.path,
							deleteWorktreeDialog.deleteBranch,
							deleteWorktreeDialog.projectPath || undefined,
						);
					}
				}}
			>
				<div className="flex items-center space-x-2">
					<Checkbox
						id="delete-branch"
						checked={deleteWorktreeDialog.deleteBranch}
						onCheckedChange={checked =>
							setDeleteWorktreeDialog(prev => ({
								...prev,
								deleteBranch: checked === true,
							}))
						}
					/>
					<label
						htmlFor="delete-branch"
						className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
					>
						Also delete the git branch
					</label>
				</div>
			</ConfirmDialog>

			{/* Stop Session Dialog */}
			<ConfirmDialog
				open={stopSessionDialog.open}
				onOpenChange={open => setStopSessionDialog(prev => ({...prev, open}))}
				title="Stop Session"
				description={`Stop session "${stopSessionDialog.session?.name || stopSessionDialog.session?.path.split('/').pop()}"?`}
				confirmLabel="Stop"
				variant="destructive"
				onConfirm={() => {
					if (stopSessionDialog.session) {
						stopSession(stopSessionDialog.session.id);
					}
				}}
			/>

			<ConfirmDialog
				open={restartSessionDialog.open}
				onOpenChange={open =>
					setRestartSessionDialog(prev => ({...prev, open}))
				}
				title="Restart Session"
				description={`Restart session "${restartSessionDialog.session?.name || restartSessionDialog.session?.path.split('/').pop()}"? This restarts only this session.`}
				confirmLabel="Restart"
				onConfirm={() => {
					if (restartSessionDialog.session) {
						restartSession(restartSessionDialog.session.id);
					}
				}}
			/>
		</aside>
	);
}
