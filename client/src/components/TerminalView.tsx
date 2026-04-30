import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { Socket } from 'socket.io-client';

interface TerminalViewProps {
    sessionId: string;
    socket: Socket;
    agentId?: string;
    normalizedAgentType?: string;
}

export const TerminalView = ({ sessionId, socket, normalizedAgentType }: TerminalViewProps) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 14,
            theme: {
                background: '#1e1e1e',
            }
        });
        
        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();
        
        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);
        
        term.open(terminalRef.current);
        fitAddon.fit();
        term.focus();
        
        xtermRef.current = term;

        // Subscribe to session
        socket.emit('subscribe_session', sessionId);

        // Handle incoming data
        const handleData = (msg: { sessionId: string, data: string } | string) => {
            const content = typeof msg === 'string' ? msg : msg.data;
            const msgSessionId = typeof msg === 'string' ? null : msg.sessionId;

            // Strict check: Ignore data from other sessions
            if (msgSessionId && msgSessionId !== sessionId) {
                return;
            }
            
            term.write(content);
        };
        
        socket.on('terminal_data', handleData);

        // Handle outgoing data
        // Filter terminal-to-host response sequences that xterm.js generates.
        // These should not be sent to the PTY as they appear as ghost input.
        // Terminal responses filtered for ALL sessions:
        // - DA (Device Attributes): \x1b[?...c or \x1b[>...c (e.g., \x1b[?1;2c)
        // - DECRPM (Mode Status): \x1b[?...;...$y (e.g., \x1b[?2004;2$y)
        // - DSR (Device Status Report): \x1b[0n or \x1b[3n
        // CPR (Cursor Position Report) handling varies by agent:
        // - Claude: debounced (rapid updates cause ghost keypresses)
        // - Others (Codex, Gemini): passed through (needed for cursor queries)
        const isClaudeSession = normalizedAgentType === 'claude';
        // CPR pattern: \x1b[row;colR
        const cprPattern = /\x1b\[\d+;\d+R/g;
        // Other terminal responses to always filter (not needed by any CLI)
        const otherResponsePattern = /\x1b\[\?[0-9;]*\$y|\x1b\[\??>[0-9;]*c|\x1b\[\?[0-9;]*c|\x1b\[[03]n/g;
        let pendingCpr: string | null = null;
        let cprTimeout: ReturnType<typeof setTimeout> | null = null;
        const CPR_DEBOUNCE_MS = 100;

        term.onData((data) => {
            // Always filter DA, DECRPM, DSR for all sessions
            let filtered = data.replace(otherResponsePattern, '');

            // Handle CPR based on session type
            const cprMatches = filtered.match(cprPattern);
            filtered = filtered.replace(cprPattern, '');

            // Send non-response data immediately
            if (filtered.length > 0) {
                socket.emit('input', { sessionId, data: filtered });
            }

            // Handle CPR responses
            if (cprMatches && cprMatches.length > 0) {
                if (isClaudeSession) {
                    // Claude: debounce CPR to prevent ghost keypresses during rapid updates
                    pendingCpr = cprMatches[cprMatches.length - 1];
                    if (cprTimeout) clearTimeout(cprTimeout);
                    cprTimeout = setTimeout(() => {
                        if (pendingCpr) {
                            socket.emit('input', { sessionId, data: pendingCpr });
                            pendingCpr = null;
                        }
                    }, CPR_DEBOUNCE_MS);
                } else {
                    // Non-Claude: send CPR immediately (needed for cursor position queries)
                    socket.emit('input', { sessionId, data: cprMatches.join('') });
                }
            }
        });

        // Handle resize
        const handleResize = () => {
            fitAddon.fit();
            socket.emit('resize', { 
                sessionId, 
                cols: term.cols, 
                rows: term.rows 
            });
        };
        
        window.addEventListener('resize', handleResize);
        // Initial fit
        setTimeout(handleResize, 100);

        return () => {
            if (cprTimeout) clearTimeout(cprTimeout);
            socket.emit('unsubscribe_session', sessionId);
            socket.off('terminal_data', handleData);
            window.removeEventListener('resize', handleResize);
            term.dispose();
        };
    }, [sessionId, socket]);

    return (
        <div className="h-full w-full flex justify-center bg-black p-6">
            <div className="w-full max-w-6xl h-full border border-gray-800 rounded-lg overflow-hidden bg-[#1e1e1e] shadow-2xl pl-2 pt-2">
                <div ref={terminalRef} className="h-full w-full" />
            </div>
        </div>
    );
};
