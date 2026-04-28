import type {
	AgentOption,
	SessionState,
	StateDetectionStrategy,
	Terminal,
} from '../types/index.js';

export type SessionFormat = 'none' | 'jsonl' | 'json' | 'sqlite' | 'multi-file';

export interface ToolCallData {
	name: string;
	input?: string;
	output?: string;
	isError?: boolean;
}

export interface ThinkingBlockData {
	content: string;
	tokenCount?: number;
}

export interface ConversationMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	timestamp: number | null;
	content: string;
	preview: string;
	model?: string;
	toolCalls?: ToolCallData[];
	thinkingBlocks?: ThinkingBlockData[];
	rawType?: string;
}

export interface SessionFileMetadata {
	agentSessionId?: string;
	startedAt?: number;
	endedAt?: number;
	messageCount?: number;
	totalTokens?: number;
	estimatedCostUsd?: number;
	model?: string;
	options?: Record<string, unknown>;
}

/**
 * Result of generateHookConfig. argsToInject is passed to the agent CLI.
 * cleanup removes any generated files on session end.
 * partialHook: when true, PTY polling still runs alongside hooks (for waiting_input).
 */
export interface HookConfigResult {
	argsToInject: string[];
	cleanup: () => void;
	partialHook?: boolean;
}

export interface AgentAdapter {
	readonly id: string;
	readonly name: string;
	readonly icon: string;
	readonly iconColor?: string;
	readonly description?: string;

	readonly command: string;
	readonly defaultOptions: AgentOption[];
	readonly promptArg?: string | 'none';
	readonly baseArgs?: string[];
	readonly detectionStrategy?: StateDetectionStrategy;

	readonly sessionFormat: SessionFormat;

	/**
	 * Generate hook config for state detection. Returns args to inject into
	 * the agent CLI and a cleanup function for session end.
	 * Returns null when the adapter does not support hook-based detection.
	 */
	generateHookConfig(
		worktreePath: string,
		port: number,
		sessionId: string,
	): HookConfigResult | null;

	detectState(terminal: Terminal, currentState: SessionState): SessionState;
	findSessionFile(
		worktreePath: string,
		afterTimestamp?: Date,
	): Promise<string | null>;
	parseMessages(sessionFilePath: string): Promise<ConversationMessage[]>;
	extractMetadata(sessionFilePath: string): Promise<SessionFileMetadata>;
	findSubAgentSessions?(sessionFilePath: string): Promise<string[]>;
}
