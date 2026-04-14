import path from 'path';
import type {AgentConfig} from '../types/index.js';
import {BaseAgentAdapter} from './base.js';
import {
	buildPreview,
	extractString,
	normalizeRole,
	normalizeTimestamp,
	safeReadJsonFile,
	safeReadLines,
} from './helpers.js';
import type {ConversationMessage, SessionFileMetadata} from './types.js';

function parseGenericRows(
	rows: Array<Record<string, unknown>>,
	prefix: string,
): ConversationMessage[] {
	return rows
		.map((row, index) => {
			const payload =
				row['payload'] && typeof row['payload'] === 'object'
					? (row['payload'] as Record<string, unknown>)
					: null;
			const content = extractString(
				payload?.['content'] ||
					payload?.['message'] ||
					payload?.['text'] ||
					row['content'] ||
					row['message'] ||
					row['text'] ||
					payload ||
					row,
			);
			if (!content) return null;
			return {
				id: `${prefix}-${index}`,
				role: normalizeRole(
					payload?.['role'] || payload?.['type'] || row['role'] || row['type'],
				),
				timestamp: normalizeTimestamp(
					row['timestamp'] ||
						payload?.['timestamp'] ||
						payload?.['created_at'] ||
						row['created_at'],
				),
				content,
				preview: buildPreview(content),
				rawType:
					typeof payload?.['type'] === 'string'
						? payload['type']
						: typeof row['type'] === 'string'
							? row['type']
							: undefined,
			};
		})
		.filter(Boolean) as ConversationMessage[];
}

export class GenericAdapter extends BaseAgentAdapter {
	constructor(agentConfig: AgentConfig) {
		super({
			id: agentConfig.id,
			name: agentConfig.name,
			icon: agentConfig.icon || 'bot',
			iconColor: agentConfig.iconColor,
			description: agentConfig.description,
			command: agentConfig.command,
			defaultOptions: agentConfig.options,
			baseArgs: agentConfig.baseArgs,
			detectionStrategy: agentConfig.detectionStrategy,
			sessionFormat: 'none',
		});
	}

	override async parseMessages(
		sessionFilePath: string,
	): Promise<ConversationMessage[]> {
		const ext = path.extname(sessionFilePath).toLowerCase();
		if (ext === '.json') {
			const parsed = safeReadJsonFile(sessionFilePath);
			if (!parsed || typeof parsed !== 'object') {
				return [];
			}
			const record = parsed as Record<string, unknown>;
			const items =
				(Array.isArray(record['messages']) && record['messages']) ||
				(Array.isArray(record['events']) && record['events']) ||
				(Array.isArray(record['entries']) && record['entries']) ||
				[record];
			return parseGenericRows(
				items.filter(item => item && typeof item === 'object') as Array<
					Record<string, unknown>
				>,
				`${this.id}-json`,
			);
		}

		const rows = safeReadLines(sessionFilePath).map(line => {
			try {
				const parsed = JSON.parse(line) as unknown;
				return parsed && typeof parsed === 'object'
					? (parsed as Record<string, unknown>)
					: {message: line};
			} catch {
				return {message: line};
			}
		});
		return parseGenericRows(rows, `${this.id}-jsonl`);
	}

	override async extractMetadata(
		sessionFilePath: string,
	): Promise<SessionFileMetadata> {
		const messages = await this.parseMessages(sessionFilePath);
		const firstTimestamp = messages.find(message => message.timestamp)?.timestamp;
		const lastTimestamp = [...messages]
			.reverse()
			.find(message => message.timestamp)?.timestamp;

		return {
			agentSessionId: path.basename(
				sessionFilePath,
				path.extname(sessionFilePath),
			),
			startedAt: firstTimestamp ?? undefined,
			endedAt: lastTimestamp ?? undefined,
			messageCount: messages.length,
		};
	}
}
