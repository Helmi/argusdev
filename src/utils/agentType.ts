import type {AgentConfig, StateDetectionStrategy} from '../types/index.js';

/** Minimal shape required to derive the normalized agent type. */
export interface NormalizedAgentTypeSource {
	id: string;
	command: string;
	kind?: 'agent' | 'terminal';
	detectionStrategy?: StateDetectionStrategy;
}

/**
 * Canonical normalized agent type used by frontend gates that key off
 * agent behavior (e.g. Claude CPR debouncing, OpenCode focus-event filtering).
 *
 * The string fallback covers user-defined agents that don't map to a known
 * built-in command/strategy — those simply won't trigger any built-in gate.
 */
export type NormalizedAgentType =
	| 'claude'
	| 'opencode'
	| 'codex'
	| 'gemini'
	| 'pi'
	| 'cursor'
	| 'kilocode'
	| 'droid'
	| 'github-copilot'
	| 'cline'
	| 'terminal'
	| (string & {});

/**
 * Map an agent profile (built-in or user-defined custom wrapper) to its
 * canonical type. Resolution order:
 *   1. terminal kind → 'terminal'
 *   2. detectionStrategy if set (most reliable)
 *   3. command-name substring match (handles wrappers like 'my-claude.sh')
 *   4. falls back to agent.id
 *
 * This is the single source of truth for "what kind of agent is this really".
 */
export function resolveNormalizedAgentType(
	agent: AgentConfig | NormalizedAgentTypeSource,
): NormalizedAgentType {
	if (agent.kind === 'terminal') {
		return 'terminal';
	}

	const strategy = agent.detectionStrategy?.trim();
	if (strategy) {
		return strategy;
	}

	const command = agent.command.toLowerCase();
	if (command.includes('claude')) return 'claude';
	if (command.includes('codex')) return 'codex';
	if (command.includes('gemini')) return 'gemini';
	if (command.includes('cursor')) return 'cursor';
	if (command.includes('pi')) return 'pi';
	if (command.includes('droid')) return 'droid';
	if (command.includes('kilo')) return 'kilocode';
	if (command.includes('opencode')) return 'opencode';
	return agent.id;
}
