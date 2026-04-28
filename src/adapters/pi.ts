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
import {writePiHookFiles} from '../utils/hookSettings.js';
import type {
	ConversationMessage,
	HookConfigResult,
	SessionFileMetadata,
} from './types.js';

export class PiAdapter extends BaseAgentAdapter {
	constructor() {
		super({
			id: 'pi',
			name: 'Pi Agent',
			icon: 'pi',
			command: 'pi',
			detectionStrategy: 'pi',
			sessionFormat: 'jsonl',
		});
	}

	override generateHookConfig(
		_worktreePath: string,
		_port: number,
		_sessionId: string,
	): HookConfigResult {
		const cleanup = writePiHookFiles();
		return {argsToInject: [], cleanup, partialHook: true};
	}

	override async findSessionFile(
		_worktreePath: string,
		afterTimestamp?: Date,
	): Promise<string | null> {
		const root = homePath('.pi', 'agent', 'sessions');
		const candidates = recursiveFindFiles(
			root,
			fileName => fileName.endsWith('.jsonl'),
			100,
		).filter(candidate =>
			withinRecentWindow(candidate, afterTimestamp, 300000),
		);
		return candidates[0] || null;
	}

	override async parseMessages(
		sessionFilePath: string,
	): Promise<ConversationMessage[]> {
		const rows = safeReadJsonLines(sessionFilePath) as Record<
			string,
			unknown
		>[];
		return rows
			.map((row, index) => {
				const content = extractString(
					row['content'] || row['message'] || row['text'],
				);
				if (!content) return null;
				const role = normalizeRole(row['role'] || row['type']);
				const timestamp = normalizeTimestamp(
					row['timestamp'] || row['created_at'],
				);
				return {
					id: `pi-${index}`,
					role,
					timestamp,
					content,
					preview: buildPreview(content),
					rawType: typeof row['type'] === 'string' ? row['type'] : undefined,
				};
			})
			.filter(Boolean) as ConversationMessage[];
	}

	override async extractMetadata(
		sessionFilePath: string,
	): Promise<SessionFileMetadata> {
		const messages = await this.parseMessages(sessionFilePath);
		const firstTimestamp = messages.find(
			message => message.timestamp,
		)?.timestamp;
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
