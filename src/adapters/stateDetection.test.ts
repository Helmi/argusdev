import {describe, expect, it} from 'vitest';
import {detectStateForStrategy} from './stateDetection.js';
import type {
	Terminal,
	SessionState,
	StateDetectionStrategy,
} from '../types/index.js';

function terminalFromLines(lines: string[]): Terminal {
	const padded = lines.slice();
	return {
		buffer: {
			active: {
				length: padded.length,
				getLine: (index: number) => {
					const text = padded[index];
					if (text === undefined) return undefined;
					return {
						translateToString: () => text,
					};
				},
			},
		},
	} as unknown as Terminal;
}

function detect(
	strategy: StateDetectionStrategy,
	lines: string[],
	currentState: SessionState = 'idle',
): SessionState {
	return detectStateForStrategy(
		strategy,
		terminalFromLines(lines),
		currentState,
	);
}

describe('detectStateForStrategy', () => {
	it('preserves Claude current state while Ctrl+R search hint is shown', () => {
		expect(
			detect('claude', ['Press Ctrl+R to toggle history search'], 'busy'),
		).toBe('busy');
	});

	it('detects Codex confirmation as waiting_input', () => {
		expect(detect('codex', ['Press Enter to confirm or Esc to cancel'])).toBe(
			'waiting_input',
		);
	});

	it('detects Gemini busy from esc-to-cancel prompt', () => {
		expect(detect('gemini', ['Running...', 'Esc to cancel'])).toBe('busy');
	});

	it('detects Cursor confirmation prompts as waiting_input', () => {
		expect(detect('cursor', ['Keep (n)', '(y) (enter)'])).toBe('waiting_input');
	});

	it('detects Cline ready banner as idle', () => {
		expect(
			detect('cline', ['[act mode] Cline is ready for your message']),
		).toBe('idle');
	});

	it('detects Pi confirmation prompts as waiting_input', () => {
		expect(detect('pi', ['Do you want to continue? [y/n]'])).toBe(
			'waiting_input',
		);
	});

	// Pi busy: loading animation shows "Working..." with optional "(escape to interrupt)"
	it('detects Pi "Working..." loading spinner as busy', () => {
		// Pi shows "⠋ Working..." during initial generation
		expect(
			detect('pi', [
				'────────────────────────────────────────',
				' ⠋ Working...',
				'',
				'────────────────────────────────────────',
				'~/project (main)',
				'$0.000 (sub) 0.0%/200k (auto)   (anthropic) claude-haiku-4-5 • high',
			]),
		).toBe('busy');
	});

	it('detects Pi "Working... (escape to interrupt)" as busy', () => {
		// Pi shows "Working... (escape to interrupt)" after agent_start event
		expect(
			detect('pi', [
				' ⠹ Working... (escape to interrupt)',
				'',
				'────────────────────────────────────────',
				'~/project (main)',
				'$0.012 (sub) 5.2%/200k (auto)   (anthropic) claude-haiku-4-5 • high',
			]),
		).toBe('busy');
	});

	it('detects Pi "Working... (esc to interrupt)" as busy', () => {
		expect(detect('pi', [' ⠙ Working... (esc to interrupt)'])).toBe('busy');
	});

	it('detects Pi auto-compacting as busy', () => {
		expect(detect('pi', [' ⠋ Auto-compacting... (escape to cancel)'])).toBe(
			'busy',
		);
	});

	it('detects Pi "(escape to cancel)" retry loader as busy', () => {
		expect(
			detect('pi', [' ⠙ Retrying (1/3) in 5s... (escape to cancel)']),
		).toBe('busy');
	});

	it('does not detect busy from plain "Working..." without spinner', () => {
		expect(
			detect('pi', [
				'Working...',
				'',
				'Example response from a previous run',
				'~/project (main)',
				'$0.000 (sub) 0.0%/200k (auto)   (anthropic) claude-haiku-4-5 • high',
			]),
		).toBe('idle');
	});

	it('does not detect busy from plain "Retrying" line without spinner', () => {
		expect(
			detect('pi', [
				'Retrying (1/3) in 5s... (escape to cancel)',
				'~/project (main)',
				'$0.000 (sub) 0.0%/200k (auto)   (anthropic) claude-haiku-4-5 • high',
			]),
		).toBe('idle');
	});

	it('detects Pi combined "escape to interrupt ctrl+c to clear" line as busy', () => {
		// When Pi renders both hints on the same line, it indicates the busy status bar
		expect(
			detect('pi', [
				'escape to interrupt ctrl+c to clear',
				'────────────────────────────────────────',
				'~/project (main)',
				'$0.005 (sub) 1.0%/200k (auto)   (anthropic) claude-haiku-4-5 • high',
			]),
		).toBe('busy');
	});

	it('detects Pi combined "(esc to interrupt) (ctrl+c to clear)" line as busy', () => {
		expect(
			detect('pi', [
				'(esc to interrupt) (ctrl+c to clear)',
				'────────────────────────────────────────',
			]),
		).toBe('busy');
	});

	it('does NOT false-positive on startup header "escape to interrupt"', () => {
		// Pi startup header shows bare "escape to interrupt" as keybinding hint.
		// This must NOT trigger busy — the session is idle at its input prompt.
		expect(
			detect('pi', [
				' pi v0.55.1',
				' escape to interrupt',
				' ctrl+c to clear',
				' ctrl+c twice to exit',
				' ctrl+d to exit (empty)',
				'────────────────────────────────────────',
				'',
				'────────────────────────────────────────',
				'~/project (main)',
				'$0.000 (sub) 0.0%/200k (auto)   (anthropic) claude-haiku-4-5 • high',
			]),
		).toBe('idle');
	});

	it('does NOT false-positive on startup header "esc to interrupt"', () => {
		expect(
			detect('pi', [
				' pi v0.55.3',
				' esc to interrupt',
				' ctrl+c to clear',
				' ctrl+d to exit (empty)',
				'────────────────────────────────────────',
				'',
				'────────────────────────────────────────',
				'~/project (main)',
				'$0.000 (sub) 0.0%/200k (auto)   (anthropic) claude-haiku-4-5 • high',
			]),
		).toBe('idle');
	});

	it('detects Pi idle after response completes', () => {
		// After a response, Pi shows the response text above the editor.
		// The editor area (between ──── separators) is active, no loading animation.
		expect(
			detect('pi', [
				'Hello world!',
				'',
				'────────────────────────────────────────',
				'',
				'────────────────────────────────────────',
				'~/project (main)',
				'↑1.2k ↓42 $0.003 (sub) 2.1%/200k (auto)   (anthropic) claude-haiku-4-5 • high',
			]),
		).toBe('idle');
	});

	it('falls back to current state for unknown strategies', () => {
		expect(
			detectStateForStrategy(
				'unknown' as StateDetectionStrategy,
				terminalFromLines(['unrelated output']),
				'busy',
			),
		).toBe('busy');
	});
});
