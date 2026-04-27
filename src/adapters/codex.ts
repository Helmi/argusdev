import path from 'path';
import {BaseAgentAdapter} from './base.js';
import {
	buildPreview,
	extractString,
	homePath,
	normalizeRole,
	normalizeTimestamp,
	recursiveFindFiles,
	safeReadJsonLines,
	withinRecentWindow,
} from './helpers.js';
import type {
	ConversationMessage,
	SessionFileMetadata,
	ToolCallData,
	ThinkingBlockData,
} from './types.js';

interface CodexLine extends Record<string, unknown> {
	type?: string;
	role?: string;
	timestamp?: unknown;
	session_meta?: Record<string, unknown>;
	response_item?: Record<string, unknown>;
	payload?: Record<string, unknown>;
}

function extractToolCallsFromMessage(
	messageRecord: Record<string, unknown>,
): ToolCallData[] {
	const toolCalls = messageRecord['tool_calls'];
	if (!Array.isArray(toolCalls)) return [];

	return toolCalls
		.map(item => {
			if (!item || typeof item !== 'object') return null;
			const record = item as Record<string, unknown>;
			const name =
				typeof record['name'] === 'string'
					? record['name']
					: typeof record['tool'] === 'string'
						? record['tool']
						: 'tool';
			return {
				name,
				input:
					record['input'] === undefined
						? undefined
						: extractString(record['input']),
				output:
					record['output'] === undefined
						? undefined
						: extractString(record['output']),
				isError: record['status'] === 'error' || record['is_error'] === true,
			};
		})
		.filter(Boolean) as ToolCallData[];
}

function extractFunctionCall(
	payload: Record<string, unknown>,
): ToolCallData | null {
	const name = typeof payload['name'] === 'string' ? payload['name'] : null;
	if (!name) return null;

	return {
		name,
		input:
			payload['arguments'] === undefined
				? undefined
				: extractString(payload['arguments']),
		output:
			payload['output'] === undefined
				? undefined
				: extractString(payload['output']),
	};
}

function extractThinkingBlocks(
	responseItem: Record<string, unknown>,
): ThinkingBlockData[] {
	const rawThinking =
		responseItem['thinking'] ||
		responseItem['reasoning'] ||
		responseItem['analysis'];
	if (!rawThinking) {
		return [];
	}

	const tokenCountRaw =
		responseItem['thinking_tokens'] || responseItem['reasoning_tokens'];
	const tokenCount =
		typeof tokenCountRaw === 'number' && Number.isFinite(tokenCountRaw)
			? tokenCountRaw
			: undefined;

	return [
		{
			content: extractString(rawThinking),
			tokenCount,
		},
	];
}

function extractReasoningSummary(payload: Record<string, unknown>): string {
	const summary = payload['summary'];
	if (!Array.isArray(summary)) {
		return '';
	}

	return summary
		.map(item => extractString(item))
		.filter(Boolean)
		.join('\n')
		.trim();
}

function getCodexPayload(row: CodexLine): Record<string, unknown> | null {
	if (row.payload && typeof row.payload === 'object') {
		return row.payload;
	}
	if (row.response_item && typeof row.response_item === 'object') {
		return row.response_item;
	}
	if (row.session_meta && typeof row.session_meta === 'object') {
		return row.session_meta;
	}
	return null;
}

function getCodexSessionMeta(row: CodexLine): Record<string, unknown> | null {
	if (
		row.type === 'session_meta' &&
		row.payload &&
		typeof row.payload === 'object'
	) {
		return row.payload;
	}
	if (row.session_meta && typeof row.session_meta === 'object') {
		return row.session_meta;
	}
	return null;
}

export class CodexAdapter extends BaseAgentAdapter {
	constructor() {
		super({
			id: 'codex',
			name: 'Codex CLI',
			icon: 'openai',
			command: 'codex',
			detectionStrategy: 'codex',
			sessionFormat: 'jsonl',
		});
	}

	override async findSessionFile(
		worktreePath: string,
		afterTimestamp?: Date,
	): Promise<string | null> {
		const root = homePath('.codex', 'sessions');
		const normalizedWorktree = path.resolve(worktreePath);
		const candidates = recursiveFindFiles(
			root,
			fileName =>
				fileName.startsWith('rollout-') && fileName.endsWith('.jsonl'),
			200,
		).filter(candidate =>
			withinRecentWindow(candidate, afterTimestamp, 300000),
		);

		for (const candidate of candidates) {
			const sample = safeReadJsonLines(candidate).slice(0, 40) as CodexLine[];
			for (const row of sample) {
				const sessionMeta = getCodexSessionMeta(row);
				if (sessionMeta && typeof sessionMeta === 'object') {
					const cwd = sessionMeta['cwd'];
					if (
						typeof cwd === 'string' &&
						path.resolve(cwd) === normalizedWorktree
					) {
						return candidate;
					}
				}
				const cwd = row['cwd'];
				if (
					typeof cwd === 'string' &&
					path.resolve(cwd) === normalizedWorktree
				) {
					return candidate;
				}
			}
		}

		return candidates[0] || null;
	}

	override async parseMessages(
		sessionFilePath: string,
	): Promise<ConversationMessage[]> {
		const rows = safeReadJsonLines(sessionFilePath) as CodexLine[];
		const messages: ConversationMessage[] = [];

		rows.forEach((row, index) => {
			const payload = getCodexPayload(row);
			const payloadType =
				typeof payload?.['type'] === 'string'
					? payload['type']
					: typeof row.type === 'string'
						? row.type
						: undefined;
			const rawRole = payload?.['role'] || row.role || payloadType || row.type;
			const role = normalizeRole(rawRole);
			const content = extractString(
				payload?.['content'] || payload?.['message'] || row['content'],
			);
			const timestamp = normalizeTimestamp(
				row.timestamp || payload?.['timestamp'] || payload?.['created_at'],
			);

			const toolCalls =
				payloadType === 'function_call'
					? (() => {
							const toolCall = payload ? extractFunctionCall(payload) : null;
							return toolCall ? [toolCall] : [];
						})()
					: payload
						? extractToolCallsFromMessage(payload)
						: [];
			const thinkingBlocks = payload ? extractThinkingBlocks(payload) : [];
			const reasoningSummary =
				payloadType === 'reasoning' && payload
					? extractReasoningSummary(payload)
					: '';
			const output =
				payloadType === 'function_call_output'
					? extractString(payload?.['output'])
					: undefined;
			const finalContent = content || reasoningSummary || output || '';
			const allThinkingBlocks =
				payloadType === 'reasoning' && reasoningSummary
					? [...thinkingBlocks, {content: reasoningSummary}]
					: thinkingBlocks;

			if (
				!finalContent &&
				toolCalls.length === 0 &&
				allThinkingBlocks.length === 0
			) {
				return;
			}

			messages.push({
				id: `codex-${index}`,
				role:
					payloadType === 'function_call_output'
						? 'tool'
						: payloadType === 'function_call'
							? 'assistant'
							: role,
				timestamp,
				content: finalContent,
				preview: buildPreview(finalContent || '[tool activity]'),
				model:
					typeof payload?.['model'] === 'string' ? payload['model'] : undefined,
				toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
				thinkingBlocks:
					allThinkingBlocks.length > 0 ? allThinkingBlocks : undefined,
				rawType: payloadType,
			});
		});

		return messages;
	}

	override async extractMetadata(
		sessionFilePath: string,
	): Promise<SessionFileMetadata> {
		const rows = safeReadJsonLines(sessionFilePath) as CodexLine[];
		const messages = await this.parseMessages(sessionFilePath);
		const firstTimestamp = messages.find(
			message => message.timestamp,
		)?.timestamp;
		const lastTimestamp = [...messages]
			.reverse()
			.find(message => message.timestamp)?.timestamp;

		let model: string | undefined;
		let totalTokens: number | undefined;
		let sessionId: string | undefined;
		let options: Record<string, unknown> | undefined;

		for (const row of rows) {
			const sessionMeta = getCodexSessionMeta(row);
			if (sessionMeta && typeof sessionMeta === 'object') {
				if (typeof sessionMeta['model'] === 'string') {
					model = sessionMeta['model'];
				}
				if (typeof sessionMeta['session_id'] === 'string') {
					sessionId = sessionMeta['session_id'];
				}
				if (typeof sessionMeta['id'] === 'string') {
					sessionId = sessionMeta['id'];
				}
				options = sessionMeta;
			}

			const usage = row['usage'];
			if (usage && typeof usage === 'object') {
				const usageRecord = usage as Record<string, unknown>;
				const maybeTokens = usageRecord['total_tokens'];
				if (typeof maybeTokens === 'number' && Number.isFinite(maybeTokens)) {
					totalTokens = maybeTokens;
				}
			}
		}

		return {
			agentSessionId:
				sessionId ||
				path.basename(sessionFilePath, path.extname(sessionFilePath)),
			startedAt: firstTimestamp ?? undefined,
			endedAt: lastTimestamp ?? undefined,
			messageCount: messages.length,
			totalTokens,
			model: model || messages.find(message => message.model)?.model,
			options,
		};
	}

	override async findSubAgentSessions(
		sessionFilePath: string,
	): Promise<string[]> {
		const rows = safeReadJsonLines(sessionFilePath) as Array<
			Record<string, unknown>
		>;
		const discovered = new Set<string>();

		for (const row of rows) {
			const responseItem = getCodexPayload(row);
			const keys = [
				'subagent_session_id',
				'subagentSessionId',
				'child_session_id',
			];
			for (const key of keys) {
				const direct = row[key];
				if (typeof direct === 'string' && direct.trim().length > 0) {
					discovered.add(direct.trim());
				}
				const nested = responseItem?.[key];
				if (typeof nested === 'string' && nested.trim().length > 0) {
					discovered.add(nested.trim());
				}
			}
		}

		return Array.from(discovered);
	}
}
