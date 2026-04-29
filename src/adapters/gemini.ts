import path from 'path';
import {BaseAgentAdapter} from './base.js';
import {
	buildPreview,
	extractString,
	homePath,
	normalizeTimestamp,
	recursiveFindFiles,
	safeReadJsonLines,
	withinRecentWindow,
} from './helpers.js';
import type {
	ConversationMessage,
	SessionFileMetadata,
	ThinkingBlockData,
} from './types.js';

interface GeminiLine extends Record<string, unknown> {
	id?: string;
	timestamp?: unknown;
	type?: string;
	content?: unknown;
	thoughts?: unknown;
	model?: string;
	tokens?: number;
}

function extractThoughts(raw: unknown): ThinkingBlockData[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map(item => {
			if (!item || typeof item !== 'object') return null;
			const record = item as Record<string, unknown>;
			const text = extractString(
				record['description'] || record['text'] || record['subject'],
			);
			if (!text) return null;
			return {content: text};
		})
		.filter(Boolean) as ThinkingBlockData[];
}

export class GeminiAdapter extends BaseAgentAdapter {
	constructor() {
		super({
			id: 'gemini',
			name: 'Gemini CLI',
			icon: 'gemini',
			command: 'gemini',
			detectionStrategy: 'gemini',
			sessionFormat: 'jsonl',
		});
	}

	override async findSessionFile(
		_worktreePath: string,
		afterTimestamp?: Date,
	): Promise<string | null> {
		// Gemini writes to ~/.gemini/tmp/<projectName>/chats/session-*.jsonl
		const root = homePath('.gemini', 'tmp');
		const candidates = recursiveFindFiles(
			root,
			fileName =>
				fileName.startsWith('session-') && fileName.endsWith('.jsonl'),
			200,
		).filter(candidate =>
			withinRecentWindow(candidate, afterTimestamp, 300000),
		);

		return candidates[0] || null;
	}

	override async parseMessages(
		sessionFilePath: string,
	): Promise<ConversationMessage[]> {
		const rows = safeReadJsonLines(sessionFilePath) as GeminiLine[];
		const messages: ConversationMessage[] = [];

		rows.forEach((row, index) => {
			const rowType = typeof row.type === 'string' ? row.type : undefined;

			// Skip metadata header and $set mutation lines
			if (!rowType || row['$set'] !== undefined) return;
			if (
				rowType !== 'user' &&
				rowType !== 'gemini' &&
				rowType !== 'assistant'
			) {
				return;
			}

			const content = extractString(row.content);
			if (!content) return;

			const timestamp = normalizeTimestamp(row.timestamp);
			const thoughts = extractThoughts(row.thoughts);
			const role = rowType === 'user' ? 'user' : 'assistant';

			messages.push({
				id: `gemini-${index}`,
				role,
				timestamp,
				content,
				preview: buildPreview(content),
				model: typeof row.model === 'string' ? row.model : undefined,
				thinkingBlocks: thoughts.length > 0 ? thoughts : undefined,
				rawType: rowType,
			});
		});

		return messages;
	}

	override async extractMetadata(
		sessionFilePath: string,
	): Promise<SessionFileMetadata> {
		const rows = safeReadJsonLines(sessionFilePath) as GeminiLine[];
		const messages = await this.parseMessages(sessionFilePath);
		const firstTimestamp = messages.find(m => m.timestamp)?.timestamp;
		const lastTimestamp = [...messages]
			.reverse()
			.find(m => m.timestamp)?.timestamp;

		let totalTokens: number | undefined;
		for (const row of rows) {
			if (typeof row.tokens === 'number' && Number.isFinite(row.tokens)) {
				totalTokens = (totalTokens ?? 0) + row.tokens;
			}
		}

		return {
			agentSessionId: path.basename(
				sessionFilePath,
				path.extname(sessionFilePath),
			),
			startedAt: firstTimestamp ?? undefined,
			endedAt: lastTimestamp ?? undefined,
			messageCount: messages.length,
			totalTokens,
			model: messages.find(m => m.model)?.model,
		};
	}
}
