import type {
	AgentOption,
	SessionState,
	StateDetectionStrategy,
	Terminal,
} from '../types/index.js';
import {detectStateForStrategy} from './stateDetection.js';
import type {
	AgentAdapter,
	ConversationMessage,
	HookConfigResult,
	SessionFileMetadata,
	SessionFormat,
} from './types.js';

export interface BaseAdapterConfig {
	id: string;
	name: string;
	icon: string;
	iconColor?: string;
	description?: string;
	command: string;
	defaultOptions?: AgentOption[];
	promptArg?: string | 'none';
	baseArgs?: string[];
	detectionStrategy?: StateDetectionStrategy;
	sessionFormat?: SessionFormat;
}

export abstract class BaseAgentAdapter implements AgentAdapter {
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

	protected constructor(config: BaseAdapterConfig) {
		this.id = config.id;
		this.name = config.name;
		this.icon = config.icon;
		this.iconColor = config.iconColor;
		this.description = config.description;
		this.command = config.command;
		this.defaultOptions = config.defaultOptions || [];
		this.promptArg = config.promptArg;
		this.baseArgs = config.baseArgs;
		this.detectionStrategy = config.detectionStrategy;
		this.sessionFormat = config.sessionFormat || 'none';
	}

	generateHookConfig(
		_worktreePath: string,
		_port: number,
		_sessionId: string,
	): HookConfigResult | null {
		return null;
	}

	detectState(terminal: Terminal, currentState: SessionState): SessionState {
		if (!this.detectionStrategy) {
			return currentState;
		}

		return detectStateForStrategy(
			this.detectionStrategy,
			terminal,
			currentState,
		);
	}

	async findSessionFile(
		_worktreePath: string,
		_afterTimestamp?: Date,
	): Promise<string | null> {
		return null;
	}

	async parseMessages(
		_sessionFilePath: string,
	): Promise<ConversationMessage[]> {
		return [];
	}

	async extractMetadata(
		_sessionFilePath: string,
	): Promise<SessionFileMetadata> {
		return {};
	}

	async findSubAgentSessions(_sessionFilePath: string): Promise<string[]> {
		return [];
	}
}
