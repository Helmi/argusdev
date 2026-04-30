import type {Socket} from 'socket.io-client';
import {apiFetch} from './apiFetch';

export type NudgePurpose = 'manual' | 'review-rejected' | 'integrate';

export interface NudgeOptions {
	purpose?: NudgePurpose;
	autoOpenPreview?: boolean;
}

export interface NudgePending {
	sessionId: string;
	text: string;
	purpose: NudgePurpose;
}

// Wrap text in bracketed-paste escape sequences and send to PTY.
// Constraint: agents that disable DECSET 2004 will see the raw escape chars
// (\x1b[200~ / \x1b[201~) rather than honouring the bracket. This is the same
// residual risk as the xterm.paste() path used for clipboard content.
export function sendNudge(
	sessionId: string,
	text: string,
	socket: Socket,
): void {
	const payload = `\x1b[200~${text}\x1b[201~\r`;
	socket.emit('input', {sessionId, data: payload});
}

// SDK sessions are not handled by the PTY socket 'input' channel — the daemon's
// globalSessionOrchestrator only knows about PTY sessions, so an emit('input')
// to an SDK sessionId silently drops. Route through the SDK message endpoint
// instead, which calls sdkSessionManager.sendMessage and spawns the next turn.
export async function sendNudgeSdk(
	sessionId: string,
	text: string,
): Promise<boolean> {
	const response = await apiFetch(`/api/sdk-session/${sessionId}/message`, {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify({content: text}),
	});
	return response.ok;
}

// Programmatic entry point for callers (reject-loop, integration nudge).
// Opens the preview dialog via the store's setNudgePending — import and call
// useAppStore().setNudgePending from React components, or use this helper
// when the store instance is available.
export function nudgeSession(
	sessionId: string,
	text: string,
	opts: NudgeOptions & {
		setNudgePending: (pending: NudgePending | null) => void;
	},
): void {
	opts.setNudgePending({
		sessionId,
		text,
		purpose: opts.purpose ?? 'manual',
	});
}
