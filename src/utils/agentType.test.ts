import {describe, expect, it} from 'vitest';
import {resolveNormalizedAgentType} from './agentType.js';
import type {AgentConfig} from '../types/index.js';

function agent(partial: Partial<AgentConfig> & {id: string}): AgentConfig {
	return {
		id: partial.id,
		name: partial.name ?? partial.id,
		kind: partial.kind ?? 'agent',
		command: partial.command ?? '',
		options: partial.options ?? [],
		detectionStrategy: partial.detectionStrategy,
		baseArgs: partial.baseArgs,
		baseEnv: partial.baseEnv,
		enabled: partial.enabled,
		promptArg: partial.promptArg,
		prependCwd: partial.prependCwd,
		sessionType: partial.sessionType,
		icon: partial.icon,
		iconColor: partial.iconColor,
	};
}

describe('resolveNormalizedAgentType', () => {
	it('returns "terminal" for terminal-kind profiles regardless of command', () => {
		expect(
			resolveNormalizedAgentType(
				agent({id: 'shell', kind: 'terminal', command: '$SHELL'}),
			),
		).toBe('terminal');
	});

	it('uses detectionStrategy when set (highest signal after kind)', () => {
		expect(
			resolveNormalizedAgentType(
				agent({
					id: 'my-claude',
					command: 'wrapper.sh',
					detectionStrategy: 'claude',
				}),
			),
		).toBe('claude');
	});

	it('falls back to command-substring match for built-ins', () => {
		expect(
			resolveNormalizedAgentType(agent({id: 'builtin', command: 'claude'})),
		).toBe('claude');
		expect(
			resolveNormalizedAgentType(agent({id: 'builtin', command: 'opencode'})),
		).toBe('opencode');
		expect(
			resolveNormalizedAgentType(agent({id: 'builtin', command: 'codex'})),
		).toBe('codex');
		expect(
			resolveNormalizedAgentType(agent({id: 'builtin', command: 'gemini'})),
		).toBe('gemini');
		expect(
			resolveNormalizedAgentType(agent({id: 'builtin', command: 'cursor'})),
		).toBe('cursor');
		expect(
			resolveNormalizedAgentType(agent({id: 'builtin', command: 'droid'})),
		).toBe('droid');
		expect(
			resolveNormalizedAgentType(agent({id: 'builtin', command: 'kilocode'})),
		).toBe('kilocode');
	});

	it('regression (td-b3a548): custom profile wrapping claude resolves to "claude"', () => {
		// User defines: { id: 'my-claude-profile', command: 'claude --special-flag' }
		// — gate must still see it as claude.
		expect(
			resolveNormalizedAgentType(
				agent({id: 'my-claude-profile', command: 'claude'}),
			),
		).toBe('claude');
	});

	it('regression (td-b3a548): custom profile wrapping opencode resolves to "opencode"', () => {
		expect(
			resolveNormalizedAgentType(
				agent({id: 'my-opencode', command: 'opencode'}),
			),
		).toBe('opencode');
	});

	it('case-insensitive command matching', () => {
		expect(
			resolveNormalizedAgentType(agent({id: 'x', command: 'CLAUDE'})),
		).toBe('claude');
	});

	it('falls back to agent.id when no built-in command matches', () => {
		expect(
			resolveNormalizedAgentType(
				agent({id: 'mystery-agent', command: 'totally-custom-thing'}),
			),
		).toBe('mystery-agent');
	});
});
