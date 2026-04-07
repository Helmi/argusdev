import {spawn, ChildProcess} from 'child_process';
import {EventEmitter} from 'events';
import {randomUUID} from 'crypto';
import {SdkEventParser} from './sdkEventParser.js';
import {logger} from '../utils/logger.js';
import type {
	SdkSession,
	SdkSessionState,
	SdkEvent,
	SdkContentBlock,
	SdkUsage,
	SdkStreamEvent,
	SdkAssistantEvent,
	SdkResultEvent,
	SdkSystemEvent,
} from '../types/index.js';

function createEmptyUsage(): SdkUsage {
	return {
		totalCostUsd: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheCreationTokens: 0,
		turns: 0,
	};
}

/**
 * Manages SDK sessions — Claude Code with structured JSON streaming.
 *
 * Each turn spawns a new `claude -p` subprocess (print mode is single-shot).
 * Multi-turn uses `--resume <claudeSessionId>` to continue the conversation.
 * The session stays alive across turns; the subprocess is per-turn.
 */
export class SdkSessionManager extends EventEmitter {
	private sessions = new Map<string, SdkSession>();
	private activeProcesses = new Map<string, ChildProcess>();
	/** Base args from the agent profile (stream-json flags etc.) */
	private sessionArgs = new Map<string, string[]>();
	private sessionEnv = new Map<string, Record<string, string>>();
	private streamingMessages = new Map<
		string,
		{blocks: Map<number, SdkContentBlock>; parentToolUseId: string | null}
	>();

	getAllSessions(): SdkSession[] {
		return [...this.sessions.values()];
	}

	getSession(sessionId: string): SdkSession | undefined {
		return this.sessions.get(sessionId);
	}

	createSession(
		worktreePath: string,
		args: string[],
		env?: Record<string, string>,
		initialPrompt?: string,
		sessionName?: string,
	): SdkSession {
		const id = `sdk-${Date.now()}-${randomUUID().slice(0, 8)}`;
		const session: SdkSession = {
			id,
			name: sessionName,
			worktreePath,
			agentId: 'claude-sdk',
			state: 'connecting',
			messages: [],
			usage: createEmptyUsage(),
			lastActivity: new Date(),
			createdAt: new Date(),
		};

		this.sessions.set(id, session);
		this.sessionArgs.set(id, args);
		if (env) this.sessionEnv.set(id, env);

		this.emit('sdkSessionCreated', session);

		// Spawn the first turn — if initialPrompt provided, use it; otherwise just init
		const prompt =
			initialPrompt || 'You are ready. The user will send a message.';
		this.spawnTurn(id, prompt);

		return session;
	}

	sendMessage(sessionId: string, content: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session || session.state === 'busy' || session.state === 'closed')
			return false;

		session.messages.push({
			id: randomUUID(),
			role: 'user',
			content: [{type: 'text', text: content}],
			timestamp: Date.now(),
		});

		this.emit('sdkSessionData', session, {type: 'user_message', content});
		this.spawnTurn(sessionId, content);
		return true;
	}

	approveToolCall(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session?.pendingApproval) return false;
		logger.info(
			`[SdkSessionManager] Approving tool call ${session.pendingApproval.id} in ${sessionId}`,
		);
		session.pendingApproval = undefined;
		return true;
	}

	rejectToolCall(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session?.pendingApproval) return false;
		logger.info(
			`[SdkSessionManager] Rejecting tool call ${session.pendingApproval.id} in ${sessionId}`,
		);
		session.pendingApproval = undefined;
		return true;
	}

	stopSession(sessionId: string): void {
		const child = this.activeProcesses.get(sessionId);
		if (child) {
			child.kill('SIGTERM');
			setTimeout(() => {
				if (this.activeProcesses.has(sessionId)) {
					child.kill('SIGKILL');
				}
			}, 5000);
		}
		this.updateState(sessionId, 'closed');
	}

	destroyAll(): void {
		for (const id of this.sessions.keys()) {
			this.stopSession(id);
		}
	}

	/** Spawn a single-turn subprocess for one prompt. */
	private spawnTurn(sessionId: string, prompt: string): void {
		const session = this.sessions.get(sessionId);
		const baseArgs = this.sessionArgs.get(sessionId);
		if (!session || !baseArgs) return;

		// Kill any previous turn process
		const existing = this.activeProcesses.get(sessionId);
		if (existing) {
			existing.kill('SIGTERM');
			this.activeProcesses.delete(sessionId);
		}

		// Build args: base args + prompt + optional resume
		const turnArgs = [...baseArgs];
		if (session.claudeSessionId) {
			turnArgs.push('--resume', session.claudeSessionId);
		}
		turnArgs.push(prompt);

		const env = this.sessionEnv.get(sessionId);
		logger.info(
			`[SdkSessionManager] Spawning turn for ${sessionId}: claude ${turnArgs.join(' ').slice(0, 200)}`,
		);

		const child = spawn('claude', turnArgs, {
			cwd: session.worktreePath,
			env: {...process.env, ...env},
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		if (!child.pid) {
			this.updateState(sessionId, 'error');
			logger.error(`[SdkSessionManager] Failed to spawn turn for ${sessionId}`);
			return;
		}

		this.activeProcesses.set(sessionId, child);
		this.updateState(sessionId, 'busy');

		const parser = new SdkEventParser();

		child.stdout?.on('data', (data: Buffer) => {
			parser.write(data.toString());
		});

		child.stderr?.on('data', (data: Buffer) => {
			const text = data.toString().trim();
			if (text)
				logger.warn(
					`[SdkSessionManager] stderr (${sessionId}): ${text.slice(0, 500)}`,
				);
		});

		child.on('exit', (code, signal) => {
			logger.info(
				`[SdkSessionManager] Turn for ${sessionId} exited (code=${code}, signal=${signal})`,
			);
			parser.flush();
			this.activeProcesses.delete(sessionId);
			this.streamingMessages.delete(sessionId);
			// Don't set closed — the session stays alive for more turns.
			// Only set idle if it was busy (normal completion).
			if (session.state === 'busy') {
				this.updateState(sessionId, 'idle');
			}
		});

		parser.on('event', (event: SdkEvent) => {
			session.lastActivity = new Date();
			this.handleEvent(sessionId, event);
		});
	}

	private updateState(sessionId: string, state: SdkSessionState): void {
		const session = this.sessions.get(sessionId);
		if (!session || session.state === state) return;
		session.state = state;
		this.emit('sdkSessionStateChanged', session);
	}

	private handleEvent(sessionId: string, event: SdkEvent): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		switch (event.type) {
			case 'system':
				this.handleSystemEvent(sessionId, session, event);
				break;
			case 'stream_event':
				this.handleStreamEvent(sessionId, session, event);
				break;
			case 'assistant':
				this.handleAssistantEvent(sessionId, session, event);
				break;
			case 'result':
				this.handleResultEvent(sessionId, session, event);
				break;
		}

		this.emit('sdkSessionData', session, event);
	}

	private handleSystemEvent(
		sessionId: string,
		session: SdkSession,
		event: SdkSystemEvent,
	): void {
		session.claudeSessionId = event.session_id;
		session.model = event.model;
		session.tools = event.tools;

		// Only add init message on first turn
		if (
			session.messages.length === 0 ||
			session.messages[0]?.role !== 'system'
		) {
			session.messages.unshift({
				id: randomUUID(),
				role: 'system',
				content: [
					{
						type: 'system_info',
						text: 'Session started',
						model: event.model,
						sessionId: event.session_id,
					},
				],
				timestamp: Date.now(),
			});
		}

		logger.info(
			`[SdkSessionManager] Session ${sessionId} initialized (model=${event.model}, claudeSession=${event.session_id})`,
		);
	}

	private handleStreamEvent(
		sessionId: string,
		session: SdkSession,
		event: SdkStreamEvent,
	): void {
		const eventType = event.event.type;

		if (eventType === 'message_start') {
			this.updateState(sessionId, 'busy');
			this.streamingMessages.set(sessionId, {
				blocks: new Map(),
				parentToolUseId: event.parent_tool_use_id,
			});
		}

		if (eventType === 'content_block_start' && event.event.content_block) {
			const block = event.event.content_block;
			const streaming = this.streamingMessages.get(sessionId);
			const idx = event.event.index ?? 0;

			if (block.type === 'text') {
				streaming?.blocks.set(idx, {type: 'text', text: ''});
			} else if (block.type === 'thinking') {
				streaming?.blocks.set(idx, {type: 'thinking', text: ''});
			} else if (block.type === 'tool_use' && block.id && block.name) {
				streaming?.blocks.set(idx, {
					type: 'tool_use',
					id: block.id,
					name: block.name,
					input: {},
				});
			}
		}

		if (eventType === 'content_block_delta' && event.event.delta) {
			const delta = event.event.delta;
			const streaming = this.streamingMessages.get(sessionId);
			const idx = event.event.index ?? 0;
			const block = streaming?.blocks.get(idx);

			if (
				block &&
				delta.type === 'text_delta' &&
				delta.text &&
				(block.type === 'text' || block.type === 'thinking')
			) {
				block.text += delta.text;
			}
		}
	}

	private handleAssistantEvent(
		sessionId: string,
		session: SdkSession,
		event: SdkAssistantEvent,
	): void {
		const blocks: SdkContentBlock[] = event.message.content.map(block => {
			if (block.type === 'text' && block.text !== undefined) {
				return {type: 'text' as const, text: block.text};
			}
			if (block.type === 'thinking' && block.text !== undefined) {
				return {type: 'thinking' as const, text: block.text};
			}
			if (block.type === 'tool_use' && block.id && block.name) {
				return {
					type: 'tool_use' as const,
					id: block.id,
					name: block.name,
					input: block.input ?? {},
				};
			}
			return {type: 'text' as const, text: `[${block.type}]`};
		});

		session.messages.push({
			id: randomUUID(),
			role: 'assistant',
			content: blocks,
			timestamp: Date.now(),
		});

		this.streamingMessages.delete(sessionId);
	}

	private handleResultEvent(
		sessionId: string,
		session: SdkSession,
		event: SdkResultEvent,
	): void {
		session.usage.totalCostUsd += event.total_cost_usd;
		session.usage.turns = event.num_turns;

		const usage = event.usage as Record<string, number>;
		session.usage.inputTokens += usage['input_tokens'] ?? 0;
		session.usage.outputTokens += usage['output_tokens'] ?? 0;
		session.usage.cacheReadTokens += usage['cache_read_input_tokens'] ?? 0;
		session.usage.cacheCreationTokens +=
			usage['cache_creation_input_tokens'] ?? 0;

		session.messages.push({
			id: randomUUID(),
			role: 'result',
			content: [{type: 'text', text: event.result}],
			timestamp: Date.now(),
			costUsd: event.total_cost_usd,
		});

		this.updateState(sessionId, event.is_error ? 'error' : 'idle');
	}
}
