import type {
	SessionState,
	StateDetectionStrategy,
	Terminal,
} from '../types/index.js';

function getTerminalLines(terminal: Terminal, maxLines = 30): string[] {
	const buffer = terminal.buffer.active;
	const lines: string[] = [];

	for (let i = buffer.length - 1; i >= 0 && lines.length < maxLines; i--) {
		const line = buffer.getLine(i);
		if (!line) continue;
		const text = line.translateToString(true);
		if (lines.length > 0 || text.trim() !== '') {
			lines.unshift(text);
		}
	}

	return lines;
}

function getTerminalContent(terminal: Terminal, maxLines = 30): string {
	return getTerminalLines(terminal, maxLines).join('\n');
}

/**
 * Detect Claude Code session state from terminal buffer.
 *
 * Detection priority (first match wins):
 *   1. waiting_input — permission/confirmation dialogs
 *   2. busy         — processing indicators (interrupt hints, spinners)
 *   3. idle         — input prompt visible (text hints or prompt box structure)
 *   4. fallback     — preserve current state
 *
 * The bottom of the terminal is most informative since Claude Code's TUI
 * renders status indicators and the input area there.
 */
function detectClaudeState(
	terminal: Terminal,
	currentState: SessionState,
): SessionState {
	const lines = getTerminalLines(terminal, 30);
	const content = lines.join('\n');

	// Focus on bottom lines where Claude Code renders its status/input area
	const bottomLines = lines.slice(-15);
	const bottomLower = bottomLines.map(l => l.toLowerCase());
	const bottomContent = bottomLower.join('\n');

	// ── 1. WAITING_INPUT: permission / confirmation dialogs ──────────

	// Yes/No confirmation prompts with visible selection
	if (/(?:do you want|would you like).+\n+[\s\S]*?(?:yes|❯)/i.test(content)) {
		return 'waiting_input';
	}

	// Permission approval dialogs (tool/command/file approval)
	if (
		bottomLines.some(
			l =>
				/(?:allow|deny)\s+(?:once|always)/i.test(l) ||
				/(?:approve|reject)\s+(?:tool|command|action)/i.test(l),
		)
	) {
		return 'waiting_input';
	}

	// Selection indicator (❯) with a question-like prompt nearby
	if (
		bottomLines.some(l => /^\s*❯/.test(l)) &&
		/(?:do you|would you|select|choose|which|allow|approve|confirm)/i.test(
			bottomContent,
		)
	) {
		return 'waiting_input';
	}

	// "esc to cancel" without an accompanying interrupt hint = waiting for user input
	if (
		bottomContent.includes('esc to cancel') &&
		!bottomContent.includes('ctrl+c to interrupt') &&
		!bottomContent.includes('esc to interrupt')
	) {
		return 'waiting_input';
	}

	// ── 2. BUSY: active processing ──────────────────────────────────

	// Interrupt hints = actively processing
	if (
		bottomContent.includes('ctrl+c to interrupt') ||
		bottomContent.includes('esc to interrupt')
	) {
		return 'busy';
	}

	// Braille spinner characters (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) in bottom area = processing
	if (bottomLines.some(l => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(l))) {
		return 'busy';
	}

	// ── 3. IDLE: input prompt visible ───────────────────────────────

	// Standard Claude Code idle hints (text-based)
	if (
		bottomContent.includes('↵ send') ||
		bottomContent.includes('enter to send') ||
		bottomContent.includes('type a message') ||
		bottomContent.includes('/ for commands')
	) {
		return 'idle';
	}

	// Prompt box structure: visible input area with box-drawing borders
	// Look for │ > (input marker) near ─╮ or ─╯ (box borders)
	const hasInputMarker = bottomLines.some(l => /│\s*>\s*/.test(l));
	const hasBoxBorder = bottomLines.some(l => /─[╮╯]/.test(l));
	if (hasInputMarker && hasBoxBorder) {
		return 'idle';
	}

	// ── 4. Fallback ─────────────────────────────────────────────────

	return currentState;
}

function detectCodexState(terminal: Terminal): SessionState {
	const content = getTerminalContent(terminal);
	const lowerContent = content.toLowerCase();

	if (
		lowerContent.includes('press enter to confirm or esc to cancel') ||
		/confirm with .+ enter/i.test(content)
	) {
		return 'waiting_input';
	}

	if (
		lowerContent.includes('allow command?') ||
		lowerContent.includes('[y/n]') ||
		lowerContent.includes('yes (y)')
	) {
		return 'waiting_input';
	}

	if (
		/(do you want|would you like)[\s\S]*?\n+[\s\S]*?\byes\b/.test(lowerContent)
	) {
		return 'waiting_input';
	}

	if (/esc.*interrupt/i.test(lowerContent)) {
		return 'busy';
	}

	return 'idle';
}

function detectGeminiState(terminal: Terminal): SessionState {
	const content = getTerminalContent(terminal);
	const lowerContent = content.toLowerCase();

	if (lowerContent.includes('waiting for user confirmation')) {
		return 'waiting_input';
	}

	if (
		content.includes('│ Apply this change') ||
		content.includes('│ Allow execution') ||
		content.includes('│ Do you want to proceed')
	) {
		return 'waiting_input';
	}

	if (
		/(allow execution|do you want to|apply this change)[\s\S]*?\n+[\s\S]*?\byes\b/.test(
			lowerContent,
		)
	) {
		return 'waiting_input';
	}

	if (lowerContent.includes('esc to cancel')) {
		return 'busy';
	}

	return 'idle';
}

function detectCursorState(terminal: Terminal): SessionState {
	const content = getTerminalContent(terminal);
	const lowerContent = content.toLowerCase();

	if (
		lowerContent.includes('(y) (enter)') ||
		lowerContent.includes('keep (n)') ||
		/auto .* \(shift\+tab\)/.test(lowerContent)
	) {
		return 'waiting_input';
	}

	if (lowerContent.includes('ctrl+c to stop')) {
		return 'busy';
	}

	return 'idle';
}

function detectGitHubCopilotState(terminal: Terminal): SessionState {
	const content = getTerminalContent(terminal);
	const lowerContent = content.toLowerCase();

	if (/confirm with .+ enter/i.test(content)) {
		return 'waiting_input';
	}

	if (lowerContent.includes('│ do you want')) {
		return 'waiting_input';
	}

	if (lowerContent.includes('esc to cancel')) {
		return 'busy';
	}

	return 'idle';
}

function detectClineState(terminal: Terminal): SessionState {
	const content = getTerminalContent(terminal);
	const lowerContent = content.toLowerCase();

	if (
		/\[(act|plan) mode\].*?\n.*yes/i.test(lowerContent) ||
		/let cline use this tool/i.test(lowerContent)
	) {
		return 'waiting_input';
	}

	if (
		/\[(act|plan) mode\].*cline is ready for your message/i.test(
			lowerContent,
		) ||
		/cline is ready for your message/i.test(lowerContent)
	) {
		return 'idle';
	}

	return 'busy';
}

function detectPiState(terminal: Terminal): SessionState {
	const content = getTerminalContent(terminal);
	const lowerContent = content.toLowerCase();
	const lines = getTerminalLines(terminal);

	// Pi confirmation prompts: "[y/n]", "press enter to confirm", session selection
	if (
		lowerContent.includes('[y/n]') ||
		/press (enter|return) to (confirm|continue)/i.test(content) ||
		/(do you want|would you like|select a session|choose a session)/i.test(
			content,
		)
	) {
		return 'waiting_input';
	}

	const hasBusySpinnerStatus = lines.some(line => {
		const lowerLine = line.toLowerCase();
		if (!/^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+/.test(line)) {
			return false;
		}

		return (
			/working\.\.\./.test(lowerLine) ||
			/auto-compacting\.\.\./.test(lowerLine) ||
			/retrying .* in \d+s\.\.\./.test(lowerLine)
		);
	});
	const hasBusyInterruptHint = lines.some(line =>
		/^[\s]*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+(?:working\.\.\.|auto-compacting\.\.\.|.*retrying .* in \d+s\.\.\.)\s*\((?:esc|escape) to (?:interrupt|cancel)\)/.test(
			line.toLowerCase(),
		),
	);
	const hasBusyCombinedHintLine = lines.some(line => {
		const lowerLine = line.toLowerCase();
		return (
			/(?:esc|escape) to (?:interrupt|cancel)/.test(lowerLine) &&
			/ctrl\+c to clear/.test(lowerLine)
		);
	});

	if (hasBusySpinnerStatus || hasBusyInterruptHint || hasBusyCombinedHintLine) {
		return 'busy';
	}

	// Pi idle: no loading animation active. Terminal shows the editor input area
	// between separator lines (────), with a footer showing path/branch and token stats.
	// Observed terminal content when idle (last lines of buffer):
	//   ────────────────────────────────────────────────────────
	//   [empty editor area or user input text]
	//   ────────────────────────────────────────────────────────
	//   ~/path (branch) • session-name
	//   $0.000 (sub) 0.0%/200k (auto)   (provider) model • thinking
	return 'idle';
}

export function detectStateForStrategy(
	strategy: StateDetectionStrategy,
	terminal: Terminal,
	currentState: SessionState,
): SessionState {
	switch (strategy) {
		case 'claude':
			return detectClaudeState(terminal, currentState);
		case 'gemini':
			return detectGeminiState(terminal);
		case 'codex':
			return detectCodexState(terminal);
		case 'cursor':
			return detectCursorState(terminal);
		case 'github-copilot':
			return detectGitHubCopilotState(terminal);
		case 'cline':
			return detectClineState(terminal);
		case 'pi':
			return detectPiState(terminal);
		default:
			return currentState;
	}
}
