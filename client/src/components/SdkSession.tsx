import {useEffect, useRef, useState, useCallback, useMemo, memo} from 'react';
import {
	X,
	Maximize2,
	Minimize2,
	MoreVertical,
	Trash2,
	Info,
	ArrowDown,
	Pencil,
	RotateCcw,
	LayoutGrid,
	DollarSign,
} from 'lucide-react';
import {useAppStore} from '@/lib/store';
import {StatusIndicator} from '@/components/StatusIndicator';
import {AgentIcon} from '@/components/AgentIcon';
import {Button} from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {SdkMessageBubble} from '@/components/SdkMessageBubble';
import {SdkInputBar} from '@/components/SdkInputBar';
import {cn} from '@/lib/utils';
import {apiFetch} from '@/lib/apiFetch';
import type {Session, SdkMessage, SdkUsage} from '@/lib/types';
import {mapSessionState} from '@/lib/types';
import {useIsMobile} from '@/hooks/useIsMobile';

interface SdkSessionProps {
	session: Session;
	isFocused?: boolean;
	onFocus: (sessionId: string) => void;
	onRemove: (sessionId: string) => void;
}

export const SdkSession = memo(
	function SdkSession({
		session,
		isFocused = false,
		onFocus,
		onRemove,
	}: SdkSessionProps) {
		const {
			socket,
			toggleContextSidebar,
			contextSidebarSessionId,
			stopSession,
			restartSession,
			renameSession,
			selectedSessions,
			agents,
			openTaskBoard,
			tdStatus,
		} = useAppStore();
		const isMobile = useIsMobile();
		const hasMultipleSessions = selectedSessions.length > 1;

		const agent = agents.find(a => a.id === session.agentId);

		const [messages, setMessages] = useState<SdkMessage[]>([]);
		const [state, setState] = useState(session.state);
		const [usage, setUsage] = useState<SdkUsage | null>(null);
		const [model, setModel] = useState('');
		const [pendingToolIds, setPendingToolIds] = useState<Set<string>>(
			new Set(),
		);
		const [isMaximized, setIsMaximized] = useState(false);
		const [isScrolledUp, setIsScrolledUp] = useState(false);

		const messagesEndRef = useRef<HTMLDivElement>(null);
		const scrollContainerRef = useRef<HTMLDivElement>(null);
		const sessionIdRef = useRef(session.id);

		const isContextOpen = contextSidebarSessionId === session.id;

		const formatName = (path: string) => path.split('/').pop() || path;

		// Keep sessionIdRef in sync
		useEffect(() => {
			sessionIdRef.current = session.id;
		}, [session.id]);

		// Update state from session prop
		useEffect(() => {
			setState(session.state);
		}, [session.state]);

		// Auto-scroll to bottom on new messages
		const scrollToBottom = useCallback(() => {
			messagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
		}, []);

		useEffect(() => {
			if (!isScrolledUp) {
				scrollToBottom();
			}
		}, [messages, isScrolledUp, scrollToBottom]);

		// Track scroll position
		const handleScroll = useCallback(() => {
			const container = scrollContainerRef.current;
			if (!container) return;
			const threshold = 50;
			const atBottom =
				container.scrollHeight - container.scrollTop - container.clientHeight <
				threshold;
			setIsScrolledUp(!atBottom);
		}, []);

		// Socket event handling
		useEffect(() => {
			const currentSocket = socket;
			const currentSessionId = session.id;

			const handleSdkEvent = (event: {
				sessionId: string;
				type: string;
				message?: SdkMessage;
				state?: string;
				usage?: SdkUsage;
				model?: string;
				toolUseId?: string;
			}) => {
				if (event.sessionId !== sessionIdRef.current) return;

				switch (event.type) {
					case 'message':
						if (event.message) {
							setMessages(prev => [...prev, event.message!]);
						}
						break;

					case 'state_change':
						if (event.state) {
							setState(event.state);
						}
						break;

					case 'usage_update':
						if (event.usage) {
							setUsage(event.usage);
						}
						break;

					case 'model_info':
						if (event.model) {
							setModel(event.model);
						}
						break;

					case 'tool_pending':
						if (event.toolUseId) {
							setPendingToolIds(prev => new Set([...prev, event.toolUseId!]));
						}
						break;

					case 'tool_resolved':
						if (event.toolUseId) {
							setPendingToolIds(prev => {
								const next = new Set(prev);
								next.delete(event.toolUseId!);
								return next;
							});
						}
						break;
				}
			};

			const handleSdkHistory = (data: {
				sessionId: string;
				messages: SdkMessage[];
				state?: string;
				usage?: SdkUsage;
				model?: string;
			}) => {
				if (data.sessionId !== sessionIdRef.current) return;
				setMessages(data.messages);
				if (data.state) setState(data.state);
				if (data.usage) setUsage(data.usage);
				if (data.model) setModel(data.model);
			};

			const handleConnect = () => {
				currentSocket.emit('subscribe_session', currentSessionId);
			};

			currentSocket.on('sdk_session_event', handleSdkEvent);
			currentSocket.on('sdk_session_history', handleSdkHistory);
			currentSocket.on('connect', handleConnect);

			if (currentSocket.connected) {
				handleConnect();
			}

			return () => {
				currentSocket.emit('unsubscribe_session', currentSessionId);
				currentSocket.off('sdk_session_event', handleSdkEvent);
				currentSocket.off('sdk_session_history', handleSdkHistory);
				currentSocket.off('connect', handleConnect);
			};
		}, [session.id, socket]);

		// API actions
		const handleSendMessage = useCallback(
			async (content: string) => {
				await apiFetch(`/api/sdk-session/${session.id}/message`, {
					method: 'POST',
					headers: {'Content-Type': 'application/json'},
					body: JSON.stringify({content}),
				});
			},
			[session.id],
		);

		const handleApprove = useCallback(async () => {
			await apiFetch(`/api/sdk-session/${session.id}/approve`, {
				method: 'POST',
			});
		}, [session.id]);

		const handleReject = useCallback(async () => {
			await apiFetch(`/api/sdk-session/${session.id}/reject`, {
				method: 'POST',
			});
		}, [session.id]);

		const handleDeleteSession = async () => {
			await stopSession(session.id);
		};

		const handleRestartSession = async () => {
			const confirmed = window.confirm(
				`Restart session "${session.name || formatName(session.path)}"? This only restarts this session.`,
			);
			if (!confirmed) return;
			await restartSession(session.id);
		};

		const handleRenameSession = async () => {
			const currentLabel = session.name || formatName(session.path);
			const nextName = window.prompt('Rename session', currentLabel);
			if (nextName === null) return;
			await renameSession(session.id, nextName.trim());
		};

		const handleScrollToBottom = useCallback(() => {
			scrollContainerRef.current?.scrollTo({
				top: scrollContainerRef.current.scrollHeight,
				behavior: 'smooth',
			});
			setIsScrolledUp(false);
		}, []);

		const handleClick = useCallback(() => {
			onFocus(session.id);
		}, [onFocus, session.id]);

		const isBusy = state === 'busy';

		// Memoize the usage display to avoid recalculating on every render
		const usageDisplay = useMemo(() => {
			if (!usage) return null;
			return `$${usage.totalCostUsd.toFixed(4)} · ${usage.turns} turns`;
		}, [usage]);

		return (
			<div
				className={cn(
					'flex min-h-0 min-w-0 flex-col bg-background outline-none',
					isMaximized && 'fixed inset-0 z-50',
					hasMultipleSessions && isFocused && 'border-2 border-primary',
				)}
				onClick={handleClick}
			>
				{/* Header — matches TerminalSession header */}
				<div
					className={cn(
						'flex h-8 items-center justify-between border-b border-border bg-card px-2',
						isFocused && 'bg-primary/10',
					)}
				>
					<div className="flex items-center gap-2 text-xs min-w-0">
						<StatusIndicator status={mapSessionState(state)} />
						<AgentIcon
							icon={agent?.icon}
							iconColor={agent?.iconColor}
							className="h-4 w-4 shrink-0"
						/>
						<span className="font-medium text-card-foreground truncate">
							{session.name || formatName(session.path)}
						</span>
						{!isMobile && model && (
							<>
								<span className="text-border shrink-0">·</span>
								<span className="text-muted-foreground truncate font-mono text-xs">
									{model}
								</span>
							</>
						)}
						{!isMobile && (
							<span className="text-muted-foreground shrink-0">({state})</span>
						)}
						{!isMobile && usageDisplay && (
							<>
								<span className="text-border shrink-0">·</span>
								<span className="flex items-center gap-0.5 text-muted-foreground shrink-0">
									<DollarSign className="h-2.5 w-2.5" />
									<span className="text-xs">{usageDisplay}</span>
								</span>
							</>
						)}
					</div>

					<div className="flex items-center gap-0.5">
						{/* Task board button */}
						{tdStatus?.projectState?.enabled && (
							<Button
								variant="ghost"
								size="icon"
								className="h-5 w-5 text-muted-foreground hover:text-foreground"
								onClick={openTaskBoard}
								title="Task board"
							>
								<LayoutGrid className="h-3 w-3" />
							</Button>
						)}

						{/* Info button */}
						<Button
							variant="ghost"
							size="icon"
							className={cn(
								'h-5 w-5',
								isContextOpen
									? 'text-foreground'
									: 'text-muted-foreground hover:text-foreground',
							)}
							onClick={() => toggleContextSidebar(session.id)}
							title="Show session context"
						>
							<Info className="h-3 w-3" />
						</Button>

						{/* Maximize/Minimize — hidden on mobile */}
						{!isMobile && (
							<Button
								variant="ghost"
								size="icon"
								className="h-5 w-5 text-muted-foreground hover:text-foreground"
								onClick={() => setIsMaximized(!isMaximized)}
							>
								{isMaximized ? (
									<Minimize2 className="h-3 w-3" />
								) : (
									<Maximize2 className="h-3 w-3" />
								)}
							</Button>
						)}

						{/* More menu */}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-5 w-5 text-muted-foreground hover:text-foreground"
								>
									<MoreVertical className="h-3 w-3" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="text-xs">
								<DropdownMenuItem onClick={handleRenameSession}>
									<Pencil className="mr-2 h-3 w-3" />
									Rename session
								</DropdownMenuItem>
								<DropdownMenuItem onClick={handleRestartSession}>
									<RotateCcw className="mr-2 h-3 w-3" />
									Restart session
								</DropdownMenuItem>
								<DropdownMenuItem
									className="text-destructive"
									onClick={handleDeleteSession}
								>
									<Trash2 className="mr-2 h-3 w-3" />
									Stop session
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>

						{/* Close (remove from view) */}
						<Button
							variant="ghost"
							size="icon"
							className="h-5 w-5 text-muted-foreground hover:text-foreground"
							onClick={() => onRemove(session.id)}
						>
							<X className="h-3 w-3" />
						</Button>
					</div>
				</div>

				{/* Message area */}
				<div
					ref={scrollContainerRef}
					className="relative min-h-0 flex-1 overflow-y-auto"
					onScroll={handleScroll}
				>
					<div className="flex flex-col gap-1 py-2">
						{messages.length === 0 && (
							<div className="flex items-center justify-center h-full py-12 text-sm text-muted-foreground">
								No messages yet. Send a message to start.
							</div>
						)}
						{messages.map(msg => (
							<SdkMessageBubble
								key={msg.id}
								message={msg}
								pendingToolIds={pendingToolIds}
								onApprove={handleApprove}
								onReject={handleReject}
							/>
						))}
						<div ref={messagesEndRef} />
					</div>

					{/* Scroll to bottom button */}
					{isScrolledUp && (
						<Button
							size="icon"
							className="absolute bottom-3 right-3 h-8 w-8 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
							onClick={handleScrollToBottom}
							title="Jump to bottom"
						>
							<ArrowDown className="h-4 w-4" />
						</Button>
					)}
				</div>

				{/* Input bar */}
				<SdkInputBar onSend={handleSendMessage} disabled={isBusy} />
			</div>
		);
	},
	(prevProps, nextProps) => {
		return (
			prevProps.session.id === nextProps.session.id &&
			prevProps.session.state === nextProps.session.state &&
			prevProps.session.name === nextProps.session.name &&
			prevProps.isFocused === nextProps.isFocused &&
			prevProps.onFocus === nextProps.onFocus &&
			prevProps.onRemove === nextProps.onRemove
		);
	},
);
