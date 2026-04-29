import type {Socket} from 'socket.io-client';

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
