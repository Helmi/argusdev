import {spawn, ChildProcess} from 'child_process';
import {EventEmitter} from 'events';
import {randomUUID} from 'crypto';
import {SdkEventParser} from './sdkEventParser.js';
import {logger} from '../utils/logger.js';
import type {
	SdkSession,
	SdkSessionState,
	SdkEvent,
	SdkMessage,
	SdkContentBlock,
	SdkUsage,
	SdkPendingApproval,
	SdkStreamEvent,
	SdkAssistantEvent,
	SdkResultEvent,
	SdkSystemEvent,
} from '../types/index.js';

function createEmptyUsage(): SdkUsage {
	return {totalCostUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0};
}

/**
 * Manages SDK sessions — Claude Code subprocesses with structured JSON streaming.
 * Parallel to SessionManager (PTY sessions). Does not use node-pty or xterm.
 */
export class SdkSessionManager extends EventEmitter {
	private sessions = new Map<string, SdkSession>();
	private processes = new Map<string, ChildProcess>();
	private parsers = new Map<string, SdkEventParser>();
	/** In-flight assistant message being streamed (assembled from content_block_delta events) */
	private streamingMessages = new Map<string, {blocks: Map<number, SdkContentBlock>; parentToolUseId: string | null}>();

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

		const child = spawn('claude', args, {
			cwd: worktreePath,
			env: {...process.env, ...env},
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		if (!child.pid) {
			session.state = 'error';
			this.emit('sdkSessionStateChanged', session);
			logger.error(`[SdkSessionManager] Failed to spawn claude subprocess for ${id}`);
			return session;
		}

		logger.info(`[SdkSessionManager] Spawned claude SDK session ${id} (PID ${child.pid}) in ${worktreePath}`);
		this.processes.set(id, child);

		const parser = new SdkEventParser();
		this.parsers.set(id, parser);

		child.stdout?.on('data', (data: Buffer) => {
			parser.write(data.toString());
		});

		child.stderr?.on('data', (data: Buffer) => {
			const text = data.toString().trim();
			if (text) logger.warn(`[SdkSessionManager] stderr (${id}): ${text.slice(0, 500)}`);
		});

		child.on('exit', (code, signal) => {
			logger.info(`[SdkSessionManager] Session ${id} exited (code=${code}, signal=${signal})`);
			parser.flush();
			this.updateState(id, 'closed');
			this.emit('sdkSessionExit', session);
			this.processes.delete(id);
			this.parsers.delete(id);
			this.streamingMessages.delete(id);
		});

		parser.on('event', (event: SdkEvent) => {
			session.lastActivity = new Date();
			this.handleEvent(id, event);
		});

		// Send initial prompt after a short delay to let the process initialize
		if (initialPrompt) {
			const sendInitialPrompt = () => {
				if (session.state === 'idle') {
					this.sendMessage(id, initialPrompt);
				} else {
					// Wait for init event
					const checkReady = () => {
						if (session.state === 'idle') {
							this.sendMessage(id, initialPrompt);
						} else if (session.state !== 'closed' && session.state !== 'error') {
							setTimeout(checkReady, 100);
						}
					};
					setTimeout(checkReady, 100);
				}
			};
			sendInitialPrompt();
		}

		this.emit('sdkSessionCreated', session);
		return session;
	}

	sendMessage(sessionId: string, content: string): boolean {
		const child = this.processes.get(sessionId);
		const session = this.sessions.get(sessionId);
		if (!child?.stdin || !session) return false;

		const msg = JSON.stringify({type: 'user', content}) + '\n';
		child.stdin.write(msg);

		session.messages.push({
			id: randomUUID(),
			role: 'user',
			content: [{type: 'text', text: content}],
			timestamp: Date.now(),
		});

		this.emit('sdkSessionData', session, {type: 'user_message', content});
		return true;
	}

	approveToolCall(sessionId: string): boolean {
		const child = this.processes.get(sessionId);
		const session = this.sessions.get(sessionId);
		if (!child?.stdin || !session?.pendingApproval) return false;

		// TODO: Determine the correct JSON format for tool approval in stream-json mode.
		// For now, this is a placeholder — the actual approval mechanism needs investigation.
		logger.info(`[SdkSessionManager] Approving tool call ${session.pendingApproval.id} in ${sessionId}`);
		session.pendingApproval = undefined;
		return true;
	}

	rejectToolCall(sessionId: string): boolean {
		const child = this.processes.get(sessionId);
		const session = this.sessions.get(sessionId);
		if (!child?.stdin || !session?.pendingApproval) return false;

		logger.info(`[SdkSessionManager] Rejecting tool call ${session.pendingApproval.id} in ${sessionId}`);
		session.pendingApproval = undefined;
		return true;
	}

	stopSession(sessionId: string): void {
		const child = this.processes.get(sessionId);
		if (child) {
			child.kill('SIGTERM');
			// Force kill after 5 seconds
			setTimeout(() => {
				if (this.processes.has(sessionId)) {
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

		// Forward raw event to API/Socket.IO layer
		this.emit('sdkSessionData', session, event);
	}

	private handleSystemEvent(sessionId: string, session: SdkSession, event: SdkSystemEvent): void {
		session.claudeSessionId = event.session_id;
		session.model = event.model;
		session.tools = event.tools;

		session.messages.push({
			id: randomUUID(),
			role: 'system',
			content: [{type: 'system_info', text: `Session started`, model: event.model, sessionId: event.session_id}],
			timestamp: Date.now(),
		});

		this.updateState(sessionId, 'idle');
		logger.info(`[SdkSessionManager] Session ${sessionId} initialized (model=${event.model}, tools=${event.tools.length})`);
	}

	private handleStreamEvent(sessionId: string, session: SdkSession, event: SdkStreamEvent): void {
		const eventType = event.event.type;

		if (eventType === 'message_start') {
			this.updateState(sessionId, 'busy');
			this.streamingMessages.set(sessionId, {blocks: new Map(), parentToolUseId: event.parent_tool_use_id});
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
				streaming?.blocks.set(idx, {type: 'tool_use', id: block.id, name: block.name, input: {}});
			}
		}

		if (eventType === 'content_block_delta' && event.event.delta) {
			const delta = event.event.delta;
			const streaming = this.streamingMessages.get(sessionId);
			const idx = event.event.index ?? 0;
			const block = streaming?.blocks.get(idx);

			if (block && delta.type === 'text_delta' && delta.text && (block.type === 'text' || block.type === 'thinking')) {
				block.text += delta.text;
			}
			if (block && delta.type === 'input_json_delta' && delta.partial_json && block.type === 'tool_use') {
				// Accumulate partial JSON for tool input — will be fully parsed from the assistant event
			}
		}
	}

	private handleAssistantEvent(sessionId: string, session: SdkSession, event: SdkAssistantEvent): void {
		const blocks: SdkContentBlock[] = event.message.content.map(block => {
			if (block.type === 'text' && block.text !== undefined) {
				return {type: 'text' as const, text: block.text};
			}
			if (block.type === 'thinking' && block.text !== undefined) {
				return {type: 'thinking' as const, text: block.text};
			}
			if (block.type === 'tool_use' && block.id && block.name) {
				return {type: 'tool_use' as const, id: block.id, name: block.name, input: block.input ?? {}};
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

	private handleResultEvent(sessionId: string, session: SdkSession, event: SdkResultEvent): void {
		session.usage.totalCostUsd = event.total_cost_usd;
		session.usage.turns = event.num_turns;

		const usage = event.usage as Record<string, number>;
		session.usage.inputTokens = usage['input_tokens'] ?? 0;
		session.usage.outputTokens = usage['output_tokens'] ?? 0;
		session.usage.cacheReadTokens = usage['cache_read_input_tokens'] ?? 0;
		session.usage.cacheCreationTokens = usage['cache_creation_input_tokens'] ?? 0;

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
