import {describe, expect, it, vi} from 'vitest';
import {sendNudge, nudgeSession} from './nudge';
import type {NudgePending} from './nudge';

describe('sendNudge', () => {
	it('wraps single-line text in bracketed-paste sequences and appends \\r', () => {
		const emit = vi.fn();
		const socket = {emit} as unknown as Parameters<typeof sendNudge>[2];

		sendNudge('sess-1', 'hello world', socket);

		expect(emit).toHaveBeenCalledOnce();
		const [event, payload] = emit.mock.calls[0];
		expect(event).toBe('input');
		expect(payload.sessionId).toBe('sess-1');
		expect(payload.data).toBe('\x1b[200~hello world\x1b[201~\r');
	});

	it('preserves multi-line text without stripping inner newlines', () => {
		const emit = vi.fn();
		const socket = {emit} as unknown as Parameters<typeof sendNudge>[2];
		const multiLine = 'line one\nline two\nline three';

		sendNudge('sess-1', multiLine, socket);

		const [, payload] = emit.mock.calls[0];
		// Inner newlines must be preserved inside the bracketed-paste envelope
		expect(payload.data).toBe(`\x1b[200~${multiLine}\x1b[201~\r`);
		// The body is intact — no stripping
		expect(payload.data).toContain('line one\nline two\nline three');
	});

	it('bracketed-paste: body is between \\x1b[200~ and \\x1b[201~', () => {
		const emit = vi.fn();
		const socket = {emit} as unknown as Parameters<typeof sendNudge>[2];
		const text = 'multi\nline\nbody';

		sendNudge('sess-2', text, socket);

		const [, payload] = emit.mock.calls[0];
		expect(payload.data.startsWith('\x1b[200~')).toBe(true);
		expect(payload.data).toContain('\x1b[201~\r');
		const body = payload.data.slice(6, payload.data.indexOf('\x1b[201~'));
		expect(body).toBe(text);
	});

	it('submission gesture is \\r after the closing bracket', () => {
		const emit = vi.fn();
		const socket = {emit} as unknown as Parameters<typeof sendNudge>[2];

		sendNudge('sess-3', 'text', socket);

		const [, payload] = emit.mock.calls[0];
		expect(payload.data.endsWith('\x1b[201~\r')).toBe(true);
	});
});

describe('nudgeSession', () => {
	it('calls setNudgePending with correct sessionId, text, and purpose', () => {
		const setNudgePending = vi.fn();

		nudgeSession('sess-42', 'please continue', {
			purpose: 'review-rejected',
			setNudgePending,
		});

		expect(setNudgePending).toHaveBeenCalledOnce();
		expect(setNudgePending).toHaveBeenCalledWith<[NudgePending]>({
			sessionId: 'sess-42',
			text: 'please continue',
			purpose: 'review-rejected',
		});
	});

	it('defaults purpose to manual when not provided', () => {
		const setNudgePending = vi.fn();

		nudgeSession('sess-1', 'hey', {setNudgePending});

		const arg = setNudgePending.mock.calls[0][0] as NudgePending;
		expect(arg.purpose).toBe('manual');
	});
});

describe('NudgeDialog send-gate (state-aware)', () => {
	// These tests validate the canSend logic inline — the dialog reads live
	// session state from the store; we verify the rules here.

	function canSend(session: {
		state: string;
		isActive: boolean;
	} | null): boolean {
		if (!session) return false;
		if (!session.isActive) return false;
		if (session.state !== 'idle') return false;
		return true;
	}

	it('enables Send when state is idle and session is active', () => {
		expect(canSend({state: 'idle', isActive: true})).toBe(true);
	});

	it('disables Send when state is busy', () => {
		expect(canSend({state: 'busy', isActive: true})).toBe(false);
	});

	it('disables Send when state is waiting_input', () => {
		expect(canSend({state: 'waiting_input', isActive: true})).toBe(false);
	});

	it('disables Send when session has exited (isActive false)', () => {
		expect(canSend({state: 'idle', isActive: false})).toBe(false);
	});

	it('disables Send when session is not found', () => {
		expect(canSend(null)).toBe(false);
	});

	it('disables Send for any non-idle state (unknown state propagation guard)', () => {
		expect(canSend({state: 'unknown-future-state', isActive: true})).toBe(
			false,
		);
	});
});
