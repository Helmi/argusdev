import React, {useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback, memo} from 'react';
import {Terminal as XTerm} from 'xterm';
import {FitAddon} from 'xterm-addon-fit';
import {WebLinksAddon} from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
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
import {
	X,
	Maximize2,
	Minimize2,
	MoreVertical,
	Copy,
	Trash2,
	GitBranch,
	ArrowDown,
	Pencil,
	RotateCcw,
	RefreshCw,
	ListTodo,
	PanelRightOpen,
	PanelRightClose,
	ClipboardPaste,
	MessageSquarePlus,
} from 'lucide-react';
import {cn} from '@/lib/utils';
import type {Session} from '@/lib/types';
import {mapSessionState} from '@/lib/types';
import {useIsMobile} from '@/hooks/useIsMobile';
import {createFilePathLinkProvider} from '@/lib/filePathLinkProvider';

// Debounced fit function to prevent layout thrashing
function createDebouncedFit(delay = 100) {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let rafId: number | null = null;

	const debounced = (
		fitAddon: FitAddon | null,
		xterm: XTerm | null,
		socket: ReturnType<typeof useAppStore>['socket'],
		sessionId: string,
		lastDims: { cols: number; rows: number },
		onColsChange?: (cols: number) => void
	) => {
		if (timeoutId) clearTimeout(timeoutId);
		if (rafId) cancelAnimationFrame(rafId);

		timeoutId = setTimeout(() => {
			rafId = requestAnimationFrame(() => {
				if (!fitAddon || !xterm) return;

				const terminalElement = xterm.element;
				const container = terminalElement?.parentElement;
				if (!terminalElement || !container) return;
				if (container.clientWidth <= 0 || container.clientHeight <= 0) return;

				fitAddon.fit();
				const { cols, rows } = xterm;

				// Only emit if dimensions actually changed
				if (cols !== lastDims.cols || rows !== lastDims.rows) {
					lastDims.cols = cols;
					lastDims.rows = rows;
					socket.emit('resize', { sessionId, cols, rows });
					onColsChange?.(cols);
				}
			});
		}, delay);
	};

	debounced.cancel = () => {
		if (timeoutId) clearTimeout(timeoutId);
		if (rafId) cancelAnimationFrame(rafId);
	};

	return debounced;
}

interface TerminalSessionProps {
	session: Session;
	slotIndex?: number;
	isFocused?: boolean;
	onFocus: (sessionId: string) => void;
	onRemove: (sessionId: string) => void;
}

// Get theme colors from CSS custom properties
function getTerminalTheme(): {
	background: string;
	foreground: string;
	cursor: string;
	selectionBackground: string;
} {
	const styles = getComputedStyle(document.documentElement);
	const bg =
		styles.getPropertyValue('--terminal-bg').trim() || 'hsl(222, 47%, 5%)';
	const fg =
		styles.getPropertyValue('--foreground').trim() || 'hsl(0, 0%, 88%)';
	const cursor =
		styles.getPropertyValue('--primary').trim() || 'hsl(160, 70%, 45%)';

	return {
		background: bg.startsWith('hsl') ? bg : `hsl(${bg})`,
		foreground: fg.startsWith('hsl') ? fg : `hsl(${fg})`,
		cursor: cursor.startsWith('hsl') ? cursor : `hsl(${cursor})`,
		selectionBackground: 'rgba(100, 200, 150, 0.3)',
	};
}

// Memoized to prevent re-renders when parent state changes but props are equal
export const TerminalSession = memo(function TerminalSession({
	session,
	slotIndex,
	isFocused = false,
	onFocus,
	onRemove,
}: TerminalSessionProps) {
	const {
		socket,
		toggleContextSidebar,
		contextSidebarSessionId,
		stopSession,
		restartSession,
		renameSession,
		theme,
		font,
		fontScale,
		selectedSessions,
		worktrees,
		agents,
		openTaskBoard,
		tdStatus,
		openFilePreview,
		setNudgePending,
	} = useAppStore();
	const isMobile = useIsMobile();
	const hasMultipleSessions = selectedSessions.length > 1;

	// Find worktree for this session to get git status
	const worktree = worktrees.find(w => w.path === session.path);

	// Find agent config for this session
	const agent = agents.find(a => a.id === session.agentId);

	// Map font type to font family string
	const fontFamilyMap: Record<string, string> = {
		jetbrains: "'JetBrains Mono', monospace",
		fira: "'Fira Code', monospace",
		source: "'Source Code Pro', monospace",
		ibm: "'IBM Plex Mono', monospace",
	};
	const fontFamily = fontFamilyMap[font] || fontFamilyMap.jetbrains;
	const [isMaximized, setIsMaximized] = useState(false);
	const [isScrolledUp, setIsScrolledUpState] = useState(false);
	const isScrolledUpRef = useRef(false);
	const setIsScrolledUp = useCallback((value: boolean) => {
		isScrolledUpRef.current = value;
		setIsScrolledUpState(value);
	}, []);
	const terminalRef = useRef<HTMLDivElement>(null);
	const xtermRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const sessionIdRef = useRef(session.id);
	// Lock to prevent checkScrollPosition from overriding programmatic scrolls
	const isProgrammaticScrollRef = useRef(false);
	const openFilePreviewRef = useRef(openFilePreview);
	openFilePreviewRef.current = openFilePreview;

	const isContextOpen = contextSidebarSessionId === session.id;

	// Format name from path
	const formatName = (path: string) => path.split('/').pop() || path;

	// Keep sessionIdRef in sync
	useEffect(() => {
		sessionIdRef.current = session.id;
	}, [session.id]);

	// Track last known dimensions to prevent redundant socket emissions
	const lastDimsRef = useRef({ cols: 0, rows: 0 });

	// Create debounced fit function once per component
	const debouncedFit = useMemo(() => createDebouncedFit(100), []);

	useLayoutEffect(() => {
		if (!terminalRef.current) return;

		// isMounted flag to prevent old listeners from firing after cleanup
		let isMounted = true;

		const term = new XTerm({
			cursorBlink: true,
			fontFamily: fontFamily,
			fontSize: Math.round(16 * (fontScale / 100)),
			theme: getTerminalTheme(),
		});

		const fitAddon = new FitAddon();
		const webLinksAddon = new WebLinksAddon();

		term.loadAddon(fitAddon);
		term.loadAddon(webLinksAddon);

		const filePathLinkDisposable = term.registerLinkProvider(
			createFilePathLinkProvider(term, (filePath: string) => {
				openFilePreviewRef.current(session.path, filePath);
			}),
		);

		term.open(terminalRef.current);
		fitAddon.fit();
		// Don't store dimensions yet - let the delayed handleResize() emit them to backend
		// Don't auto-focus on mount - let isFocused prop control this
		if (isFocused) {
			term.focus();
		}

		xtermRef.current = term;
		fitAddonRef.current = fitAddon;

		// Capture current socket and sessionId for cleanup
		const currentSocket = socket;
		const currentSessionId = session.id;
		const isDevMode = import.meta.env.DEV;

		// DIAGNOSTIC: track replay window to log xterm-generated responses to host
		// during/just after history replay. Remove once root cause is confirmed.
		const REPLAY_WINDOW_MS = 600;
		let replayWindowUntil = 0;
		const queryPatterns: Array<{ name: string; re: RegExp }> = [
			{ name: 'CPR-query \\x1b[6n', re: /\x1b\[6n/g },
			{ name: 'DSR-query \\x1b[5n', re: /\x1b\[5n/g },
			{ name: 'DA1 \\x1b[c / \\x1b[?c', re: /\x1b\[\??c/g },
			{ name: 'DA2 \\x1b[>c', re: /\x1b\[>c/g },
			{ name: 'DECRQM \\x1b[?...$p', re: /\x1b\[\?[0-9;]+\$p/g },
		];

		const handleDataWithDiag = (msg: {sessionId: string; data: string} | string) => {
			const content = typeof msg === 'string' ? msg : msg.data;
			const msgSessionId = typeof msg === 'string' ? null : msg.sessionId;
			if (!isMounted) return;
			if (msgSessionId && msgSessionId !== sessionIdRef.current) return;

			// Only the first big payload after subscribe is replay; arm the window
			// when we see a chunk larger than ~1KB (live data is usually small).
			if (content.length > 1024 && replayWindowUntil === 0) {
				replayWindowUntil = Date.now() + REPLAY_WINDOW_MS;
				const counts = queryPatterns
					.map(p => ({ name: p.name, count: (content.match(p.re) || []).length }))
					.filter(c => c.count > 0);
				console.log(
					`[term-diag] replay for ${sessionIdRef.current} agent=${session.agentId} bytes=${content.length} queries=${
						counts.length ? JSON.stringify(counts) : 'none'
					}`,
				);
			}
			term.write(content);
		};

		currentSocket.on('terminal_data', handleDataWithDiag);

		// Handle outgoing data - uses ref for current session.id
		// Filter terminal-to-host response sequences that xterm.js generates.
		// These should not be sent to the PTY as they appear as ghost input.
		// Terminal responses filtered for ALL sessions:
		// - DA (Device Attributes): \x1b[?...c or \x1b[>...c (e.g., \x1b[?1;2c)
		// - DECRPM (Mode Status): \x1b[?...;...$y (e.g., \x1b[?2004;2$y)
		// - DSR (Device Status Report): \x1b[0n or \x1b[3n
		// CPR (Cursor Position Report) handling varies by agent:
		// - Claude: debounced (rapid updates cause ghost keypresses)
		// - Others (Codex, Gemini): passed through (needed for cursor queries)
		const isClaudeSession = session.agentId === 'claude';
		// CPR pattern: \x1b[row;colR
		const cprPattern = /\x1b\[\d+;\d+R/g;
		// Other terminal responses to always filter (not needed by any CLI)
		const otherResponsePattern = /\x1b\[\?[0-9;]*\$y|\x1b\[\??>[0-9;]*c|\x1b\[\?[0-9;]*c|\x1b\[[03]n/g;
		let pendingCpr: string | null = null;
		let cprTimeout: ReturnType<typeof setTimeout> | null = null;
		const CPR_DEBOUNCE_MS = 100;

		const onDataDisposable = term.onData(data => {
			// DIAGNOSTIC: log any onData fired during the replay window
			if (replayWindowUntil > 0 && Date.now() < replayWindowUntil) {
				const hex = Array.from(data)
					.map(c => {
						const code = c.charCodeAt(0);
						return code < 32 || code === 127
							? '\\x' + code.toString(16).padStart(2, '0')
							: c;
					})
					.join('');
				console.log(
					`[term-diag] onData during replay agent=${session.agentId} len=${data.length} bytes="${hex}"`,
				);
			}

			// Always filter DA, DECRPM, DSR for all sessions
			let filtered = data.replace(otherResponsePattern, '');

			// Handle CPR based on session type
			const cprMatches = filtered.match(cprPattern);
			filtered = filtered.replace(cprPattern, '');

			// Send non-response data immediately
			if (filtered.length > 0) {
				currentSocket.emit('input', {sessionId: sessionIdRef.current, data: filtered});
			}

			// Handle CPR responses
			if (cprMatches && cprMatches.length > 0) {
				if (isClaudeSession) {
					// Claude: debounce CPR to prevent ghost keypresses during rapid updates
					pendingCpr = cprMatches[cprMatches.length - 1];
					if (cprTimeout) clearTimeout(cprTimeout);
					cprTimeout = setTimeout(() => {
						if (pendingCpr) {
							currentSocket.emit('input', {sessionId: sessionIdRef.current, data: pendingCpr});
							pendingCpr = null;
						}
					}, CPR_DEBOUNCE_MS);
				} else {
					// Non-Claude: send CPR immediately (needed for cursor position queries)
					currentSocket.emit('input', {sessionId: sessionIdRef.current, data: cprMatches.join('')});
				}
			}
		});

		// Check if terminal is scrolled up from bottom
		let lastIsAtBottom = true;
		const checkScrollPosition = () => {
			// Skip check during programmatic scroll to prevent race condition
			if (isProgrammaticScrollRef.current) return;

			const buffer = term.buffer.active;
			const isAtBottom = buffer.viewportY >= buffer.baseY;
			if (isAtBottom !== lastIsAtBottom) {
				lastIsAtBottom = isAtBottom;
				setIsScrolledUp(!isAtBottom);
			}
		};

		// Check position after wheel events (user scrolling)
		const wheelHandler = () => {
			// Small delay to let xterm process the wheel event first
			setTimeout(checkScrollPosition, 10);
		};
		terminalRef.current.addEventListener('wheel', wheelHandler, { passive: true });

		// Clipboard image paste handler
		const pasteHandler = async (e: ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;

			// Check for image items first
			let imageItem: DataTransferItem | null = null;
			for (const item of items) {
				if (item.type.startsWith('image/')) {
					imageItem = item;
					break;
				}
			}

			// Only handle images - let text paste through to xterm.js
			if (!imageItem) return;

			e.preventDefault();

			const blob = imageItem.getAsFile();
			if (!blob) return;

			// Show feedback in terminal
			term.write('\r\n[Uploading image...]\r\n');

			// Convert to base64
			const reader = new FileReader();
			reader.onload = () => {
				const base64 = reader.result as string;
				currentSocket.emit('paste_image', {
					sessionId: sessionIdRef.current,
					imageData: base64,
					mimeType: imageItem!.type,
				});
			};
			reader.onerror = () => {
				term.write('\r\n[Image upload failed]\r\n');
			};
			reader.readAsDataURL(blob);
		};
		terminalRef.current.addEventListener('paste', pasteHandler);

		// Handle image path response from server
		const handleImagePath = ({
			sessionId,
			filePath,
			error,
		}: {
			sessionId: string;
			filePath?: string;
			error?: string;
		}) => {
			if (sessionId !== sessionIdRef.current) return;

			if (error) {
				term.write(`\r\n[Error: ${error}]\r\n`);
				return;
			}

			// Write the file path to terminal (quoted, with trailing space for UX)
			currentSocket.emit('input', {
				sessionId: sessionIdRef.current,
				data: `'${filePath}' `,
			});
		};
		currentSocket.on('image_path', handleImagePath);

		// Custom touch scroll handling for mobile
		// xterm.js has poor native touch support, so we implement manual scrolling
		// Use pointer events with capture to intercept before xterm's handlers
		let pointerLastY = 0;
		let accumulatedDelta = 0;
		let activePointerId: number | null = null;
		const PIXELS_PER_LINE = 10; // Scroll 1 line per 10px of movement

		const pointerDownHandler = (e: PointerEvent) => {
			// Only handle touch, not mouse (mouse scrolling works fine)
			if (e.pointerType !== 'touch') return;
			activePointerId = e.pointerId;
			pointerLastY = e.clientY;
			accumulatedDelta = 0;
		};

		const pointerMoveHandler = (e: PointerEvent) => {
			if (e.pointerType !== 'touch' || e.pointerId !== activePointerId) return;

			const deltaY = pointerLastY - e.clientY;
			pointerLastY = e.clientY;

			accumulatedDelta += deltaY;

			// Scroll when we've accumulated enough movement
			const linesToScroll = Math.trunc(accumulatedDelta / PIXELS_PER_LINE);
			if (linesToScroll !== 0) {
				term.scrollLines(linesToScroll);
				accumulatedDelta -= linesToScroll * PIXELS_PER_LINE;
				checkScrollPosition();
			}
		};

		const pointerUpHandler = (e: PointerEvent) => {
			if (e.pointerId === activePointerId) {
				activePointerId = null;
				accumulatedDelta = 0;
				checkScrollPosition();
			}
		};

		// Use capture phase to get events before xterm's handlers
		const termEl = terminalRef.current;
		termEl.addEventListener('pointerdown', pointerDownHandler, { capture: true });
		termEl.addEventListener('pointermove', pointerMoveHandler, { capture: true });
		termEl.addEventListener('pointerup', pointerUpHandler, { capture: true });
		termEl.addEventListener('pointercancel', pointerUpHandler, { capture: true });

		// Track when data arrives so we can auto-scroll ONLY if the user is at the bottom.
		// Do NOT call checkScrollPosition here — it causes scroll jumps when the user
		// is scrolled up reading output and new data arrives (e.g. AskUserQuestion).
		const onWriteDisposable = term.onWriteParsed(() => {
			// If user was at the bottom, keep them there by re-checking.
			// If user was scrolled up, do nothing — preserve their position.
			if (!isScrolledUpRef.current) {
				// User was following output — ensure we stay at bottom
				const buffer = term.buffer.active;
				const isAtBottom = buffer.viewportY >= buffer.baseY;
				if (!isAtBottom) {
					term.scrollToBottom();
				}
			}
		});

		// Debounced resize handler - prevents feedback loop and API storm
		const handleResize = () => {
			debouncedFit(
				fitAddonRef.current,
				xtermRef.current,
				currentSocket,
				sessionIdRef.current,
				lastDimsRef.current
			);
		};

		const subscribeSession = () => {
			if (isDevMode) {
				console.log(
					`[TerminalSession] Subscribing to session ${currentSessionId}, socket ${currentSocket.id}`,
				);
			}

			currentSocket.emit('subscribe_session', currentSessionId);
		};

		const handleConnect = () => {
			subscribeSession();
			lastDimsRef.current.cols = 0;
			lastDimsRef.current.rows = 0;
			handleResize();
		};

		currentSocket.on('connect', handleConnect);
		if (currentSocket.connected) {
			handleConnect();
		}

		// Re-fit multiple times during startup because iOS Safari often reports
		// unstable viewport/font metrics right after mount.
		const initialFitTimers = [0, 220, 700, 1400].map(delay =>
			setTimeout(() => {
				handleResize();
			}, delay)
		);

		const handleViewportChange = () => {
			handleResize();
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				handleResize();
			}
		};

		const handleFontMetricsChange = () => {
			handleResize();
		};

		window.addEventListener('resize', handleViewportChange);
		window.addEventListener('orientationchange', handleViewportChange);
		window.addEventListener('pageshow', handleViewportChange);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		const visualViewport = window.visualViewport;
		visualViewport?.addEventListener('resize', handleViewportChange);
		visualViewport?.addEventListener('scroll', handleViewportChange);

		const fontSet = document.fonts;
		void fontSet.ready.then(() => {
			if (isMounted) {
				handleResize();
			}
		});
		fontSet.addEventListener('loadingdone', handleFontMetricsChange);

		// ResizeObserver handles both window and container resizes
		const resizeObserver = new ResizeObserver(() => {
			handleResize();
		});

		if (terminalRef.current) {
			resizeObserver.observe(terminalRef.current);
		}

		return () => {
			// Mark as unmounted to prevent old listeners from firing
			isMounted = false;

			// Debug log in dev mode
			if (isDevMode) {
				console.log(
					`[TerminalSession] Unsubscribing from session ${currentSessionId}, socket ${currentSocket.id}`,
				);
			}

			// Cancel any pending debounced calls
			debouncedFit.cancel();

			// Clear any pending CPR timeout
			if (cprTimeout) {
				clearTimeout(cprTimeout);
			}

			// Unsubscribe BEFORE removing listeners to ensure proper cleanup
			currentSocket.emit('unsubscribe_session', currentSessionId);

			// Use captured references for cleanup to ensure correct socket/session
			currentSocket.off('connect', handleConnect);
			currentSocket.off('terminal_data', handleDataWithDiag);
			currentSocket.off('image_path', handleImagePath);
			initialFitTimers.forEach(timer => clearTimeout(timer));
			window.removeEventListener('resize', handleViewportChange);
			window.removeEventListener('orientationchange', handleViewportChange);
			window.removeEventListener('pageshow', handleViewportChange);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			visualViewport?.removeEventListener('resize', handleViewportChange);
			visualViewport?.removeEventListener('scroll', handleViewportChange);
			fontSet.removeEventListener('loadingdone', handleFontMetricsChange);
			resizeObserver.disconnect();
			onDataDisposable.dispose();
			onWriteDisposable.dispose();
			filePathLinkDisposable.dispose();
			if (terminalRef.current) {
				terminalRef.current.removeEventListener('wheel', wheelHandler);
				terminalRef.current.removeEventListener('paste', pasteHandler);
				terminalRef.current.removeEventListener('pointerdown', pointerDownHandler, { capture: true });
				terminalRef.current.removeEventListener('pointermove', pointerMoveHandler, { capture: true });
				terminalRef.current.removeEventListener('pointerup', pointerUpHandler, { capture: true });
				terminalRef.current.removeEventListener('pointercancel', pointerUpHandler, { capture: true });
			}
			term.dispose();
			xtermRef.current = null;
			fitAddonRef.current = null;
		};
	}, [session.id, socket, debouncedFit]);

	// Re-fit when maximized state changes
	useEffect(() => {
		// Use debounced fit to handle size change after maximize animation
		debouncedFit(
			fitAddonRef.current,
			xtermRef.current,
			socket,
			session.id,
			lastDimsRef.current
		);
	}, [isMaximized, debouncedFit, socket, session.id]);

	// Update terminal theme when app theme changes
	useEffect(() => {
		if (xtermRef.current) {
			// Give CSS time to apply new theme variables
			setTimeout(() => {
				if (xtermRef.current) {
					xtermRef.current.options.theme = getTerminalTheme();
				}
			}, 50);
		}
	}, [theme]);

	// Update terminal font size when fontScale changes
	useEffect(() => {
		if (xtermRef.current) {
			xtermRef.current.options.fontSize = Math.round(16 * (fontScale / 100));
			// Use debounced fit for font size changes
			debouncedFit(
				fitAddonRef.current,
				xtermRef.current,
				socket,
				session.id,
				lastDimsRef.current
			);
		}
	}, [fontScale, debouncedFit, socket, session.id]);

	// Update terminal font family when font changes
	useEffect(() => {
		if (xtermRef.current) {
			xtermRef.current.options.fontFamily = fontFamily;
			// Use debounced fit for font family changes
			debouncedFit(
				fitAddonRef.current,
				xtermRef.current,
				socket,
				session.id,
				lastDimsRef.current
			);
		}
	}, [font, fontFamily, debouncedFit, socket, session.id]);

	// Focus terminal when isFocused becomes true, only scroll to bottom if
	// user was already at the bottom — prevents scroll jumps when regaining focus
	// while reading scrollback (e.g. during AskUserQuestion tool execution).
	useEffect(() => {
		if (isFocused && xtermRef.current) {
			const wasScrolledUp = isScrolledUp;

			isProgrammaticScrollRef.current = true;

			requestAnimationFrame(() => {
				xtermRef.current?.focus();

				if (!wasScrolledUp) {
					xtermRef.current?.scrollToBottom();
					setIsScrolledUp(false);
				}

				requestAnimationFrame(() => {
					isProgrammaticScrollRef.current = false;
				});
			});
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isFocused]);

	const handleCopyOutput = () => {
		if (xtermRef.current) {
			const selection = xtermRef.current.getSelection();
			if (selection) {
				navigator.clipboard.writeText(selection);
			}
		}
	};

	const handleMobilePaste = async () => {
		try {
			const text = await navigator.clipboard.readText();
			if (text) {
				// Use xterm's paste() so bracketed-paste wrapping applies when the
				// running program has enabled DECSET 2004 (bash/zsh/fish/editors do).
				// paste() fires onData, which is already wired to socket.emit('input').
				xtermRef.current?.paste(text);
			}
		} catch {
			xtermRef.current?.write('\r\n[Paste failed: clipboard access denied]\r\n');
		}
	};

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
		if (!xtermRef.current) return;

		// Set lock BEFORE scrolling to prevent race with checkScrollPosition
		isProgrammaticScrollRef.current = true;

		xtermRef.current.scrollToBottom();
		setIsScrolledUp(false);

		// Clear lock after viewport settles (double rAF ensures render completes)
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				isProgrammaticScrollRef.current = false;
			});
		});
	}, []);

	// Force xterm to redraw and trigger a PTY SIGWINCH so the TUI agent redraws.
	// Mirrors what manual browser resize does — useful when codex/claude leave gibberish.
	const handleRedraw = useCallback(() => {
		const term = xtermRef.current;
		const fitAddon = fitAddonRef.current;
		if (!term || !fitAddon) return;

		term.refresh(0, term.rows - 1);

		const { cols, rows } = term;
		if (cols > 1) {
			socket.emit('resize', { sessionId: session.id, cols: cols - 1, rows });
		}
		setTimeout(() => {
			if (!xtermRef.current || !fitAddonRef.current) return;
			fitAddonRef.current.fit();
			const next = { cols: xtermRef.current.cols, rows: xtermRef.current.rows };
			lastDimsRef.current = next;
			socket.emit('resize', { sessionId: session.id, ...next });
			xtermRef.current.refresh(0, xtermRef.current.rows - 1);
		}, 60);
	}, [socket, session.id]);

	// Handle clicking the terminal area to focus
	const handleTerminalClick = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		onFocus(session.id);
		// Ensure xterm gets focus
		requestAnimationFrame(() => {
			xtermRef.current?.focus();
		});
	}, [onFocus, session.id]);

	return (
		<div
			className={cn(
				'flex min-h-0 min-w-0 flex-col bg-terminal-bg outline-none',
				isMaximized && 'fixed inset-0 z-50',
				hasMultipleSessions && isFocused && 'border-2 border-primary',
			)}
			onClick={handleTerminalClick}
		>
			{/* Terminal header */}
			<div
				className={cn(
					'flex h-8 items-center justify-between border-b border-border bg-card px-2',
					slotIndex !== undefined && 'cursor-pointer',
					isFocused && 'bg-primary/10',
				)}
				onClick={e => e.stopPropagation()}
			>
				<div className="flex items-center gap-2 text-xs min-w-0">
					<StatusIndicator status={mapSessionState(session.state)} />
					<AgentIcon
						icon={agent?.icon}
						iconColor={agent?.iconColor}
						className="h-4 w-4 shrink-0"
					/>
					<span className="font-medium text-card-foreground truncate">
						{session.name || formatName(session.path)}
					</span>
					{/* Branch name with git icon - hidden on mobile */}
					{!isMobile && worktree && (
						<>
							<span className="text-border shrink-0">•</span>
							<GitBranch className="h-3 w-3 text-accent shrink-0" />
							<span className={cn(
								'text-muted-foreground truncate',
								worktree.isMainWorktree && 'text-yellow-500'
							)}>
								{worktree.branch || formatName(worktree.path)}
							</span>
						</>
					)}
					{/* Status text - hidden on mobile */}
					{!isMobile && <span className="text-muted-foreground shrink-0">({session.state})</span>}
					{/* Git status badge - hidden on mobile */}
					{!isMobile && worktree?.gitStatus &&
						(worktree.gitStatus.filesAdded > 0 ||
							worktree.gitStatus.filesDeleted > 0) && (
							<span className="flex items-center gap-1 font-mono text-[11px] shrink-0">
								{worktree.gitStatus.filesAdded > 0 && (
									<span className="text-green-500">
										+{worktree.gitStatus.filesAdded}
									</span>
								)}
								{worktree.gitStatus.filesDeleted > 0 && (
									<span className="text-red-500">
										-{worktree.gitStatus.filesDeleted}
									</span>
								)}
							</span>
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
							<ListTodo className="h-3.5 w-3.5" />
						</Button>
					)}

					{/* Context sidebar toggle */}
					<Button
						variant="ghost"
						size="icon"
						className="h-5 w-5 text-muted-foreground hover:text-foreground"
						onClick={() => toggleContextSidebar(session.id)}
						title={isContextOpen ? 'Hide session context' : 'Show session context'}
					>
						{isContextOpen ? (
							<PanelRightClose className="h-3.5 w-3.5" />
						) : (
							<PanelRightOpen className="h-3.5 w-3.5" />
						)}
					</Button>

					{/* Force redraw - fixes gibberish from TUI agents */}
					<Button
						variant="ghost"
						size="icon"
						className="h-5 w-5 text-muted-foreground hover:text-foreground"
						onClick={handleRedraw}
						title="Redraw terminal"
					>
						<RefreshCw className="h-3.5 w-3.5" />
					</Button>

					{/* Nudge — send text to PTY; only for PTY sessions (SDK has no PTY) */}
					{session.type !== 'sdk' && (
						<Button
							variant="ghost"
							size="icon"
							className="h-5 w-5 text-muted-foreground hover:text-foreground"
							onClick={() =>
								setNudgePending({
									sessionId: session.id,
									text: '',
									purpose: 'manual',
								})
							}
							title="Nudge session"
						>
							<MessageSquarePlus className="h-3.5 w-3.5" />
						</Button>
					)}

					{/* Maximize/Minimize - hidden on mobile */}
					{!isMobile && (
						<Button
							variant="ghost"
							size="icon"
							className="h-5 w-5 text-muted-foreground hover:text-foreground"
							onClick={() => setIsMaximized(!isMaximized)}
						>
							{isMaximized ? (
								<Minimize2 className="h-3.5 w-3.5" />
							) : (
								<Maximize2 className="h-3.5 w-3.5" />
							)}
						</Button>
					)}

					{/* Mobile paste button — iOS Safari can't trigger paste event on xterm */}
					{isMobile && (
						<Button
							variant="ghost"
							size="icon"
							className="h-5 w-5 text-muted-foreground hover:text-foreground"
							onClick={handleMobilePaste}
							title="Paste from clipboard"
						>
							<ClipboardPaste className="h-3.5 w-3.5" />
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
								<MoreVertical className="h-3.5 w-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="text-xs">
							<DropdownMenuItem onClick={handleCopyOutput}>
								<Copy className="mr-2 h-3 w-3" />
								Copy selection
							</DropdownMenuItem>
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
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>

			{/* Terminal content */}
			<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
				<div ref={terminalRef} className="h-full w-full min-w-0" />
				{/* Jump to bottom button */}
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
		</div>
	);
}, (prevProps, nextProps) => {
	// Custom comparison - only re-render if these specific props change
	return (
		prevProps.session.id === nextProps.session.id &&
		prevProps.session.state === nextProps.session.state &&
		prevProps.session.name === nextProps.session.name &&
		prevProps.slotIndex === nextProps.slotIndex &&
		prevProps.isFocused === nextProps.isFocused &&
		prevProps.onFocus === nextProps.onFocus &&
		prevProps.onRemove === nextProps.onRemove
	);
});
