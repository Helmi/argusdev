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

function detectClaudeState(
	terminal: Terminal,
	currentState: SessionState,
): SessionState {
	const content = getTerminalContent(terminal);
	const lowerContent = content.toLowerCase();

	// Confirmation prompts (yes/no or selection dialogs)
	if (
		/(?:do you want|would you like).+\n+[\s\S]*?(?:yes|❯)/.test(lowerContent)
	) {
		return 'waiting_input';
	}

	// "esc to cancel" without an accompanying interrupt hint = waiting for input
	if (
		lowerContent.includes('esc to cancel') &&
		!lowerContent.includes('ctrl+c to interrupt') &&
		!lowerContent.includes('esc to interrupt')
	) {
		return 'waiting_input';
	}

	// Active processing
	if (
		lowerContent.includes('ctrl+c to interrupt') ||
		lowerContent.includes('esc to interrupt')
	) {
		return 'busy';
	}

	// Idle: input prompt visible
	// "↵ send" — standard Claude Code idle hint
	// "type a message" — fallback idle hint in some versions
	if (
		lowerContent.includes('↵ send') ||
		lowerContent.includes('enter to send') ||
		lowerContent.includes('type a message')
	) {
		return 'idle';
	}

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
