import path from 'path';
import {existsSync, readFileSync} from 'fs';
import {BaseAgentAdapter} from './base.js';
import {
	buildPreview,
	extractString,
	homePath,
	normalizeRole,
	normalizeTimestamp,
	recursiveFindFiles,
	safeReadJsonFile,
	safeReadJsonLines,
	withinRecentWindow,
} from './helpers.js';
import {writeOpencodePluginFile} from '../utils/hookSettings.js';
import type {
	ConversationMessage,
	HookConfigResult,
	SessionFileMetadata,
} from './types.js';

function parseOpencodeMessages(sessionFilePath: string): ConversationMessage[] {
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
			[];

		return items
			.map((item, index) => {
				if (!item || typeof item !== 'object') return null;
				const row = item as Record<string, unknown>;
				const content = extractString(
					row['content'] || row['message'] || row['text'],
				);
				if (!content) return null;
				return {
					id: `opencode-json-${index}`,
					role: normalizeRole(row['role'] || row['type']),
					timestamp: normalizeTimestamp(row['timestamp'] || row['created_at']),
					content,
					preview: buildPreview(content),
					model: typeof row['model'] === 'string' ? row['model'] : undefined,
				};
			})
			.filter(Boolean) as ConversationMessage[];
	}

	const rows = safeReadJsonLines(sessionFilePath) as Record<string, unknown>[];
	return rows
		.map((row, index) => {
			const content = extractString(
				row['content'] || row['message'] || row['text'],
			);
			if (!content) return null;
			return {
				id: `opencode-jsonl-${index}`,
				role: normalizeRole(row['role'] || row['type']),
				timestamp: normalizeTimestamp(row['timestamp'] || row['created_at']),
				content,
				preview: buildPreview(content),
				model: typeof row['model'] === 'string' ? row['model'] : undefined,
			};
		})
		.filter(Boolean) as ConversationMessage[];
}

function fileContainsWorktree(
	candidatePath: string,
	worktreePath: string,
): boolean {
	try {
		const content = readFileSync(candidatePath, 'utf8');
		return content.includes(path.resolve(worktreePath));
	} catch {
		return false;
	}
}

export class OpencodeAdapter extends BaseAgentAdapter {
	constructor() {
		super({
			id: 'opencode',
			name: 'Opencode',
			icon: 'opencode',
			command: 'opencode',
			sessionFormat: 'multi-file',
		});
	}

	override generateHookConfig(
		worktreePath: string,
		port: number,
		sessionId: string,
	): HookConfigResult {
		const cleanup = writeOpencodePluginFile(worktreePath, port, sessionId);
		return {argsToInject: [], cleanup};
	}

	override async findSessionFile(
		worktreePath: string,
		afterTimestamp?: Date,
	): Promise<string | null> {
		const roots = [
			homePath('.opencode'),
			homePath('.config', 'opencode'),
			path.join(worktreePath, '.opencode'),
		].filter(root => existsSync(root));

		const candidates = roots
			.flatMap(root =>
				recursiveFindFiles(
					root,
					fileName =>
						/(session|conversation|chat|history)/i.test(fileName) &&
						/(\.jsonl|\.json)$/i.test(fileName),
					120,
				),
			)
			.filter(candidate =>
				withinRecentWindow(candidate, afterTimestamp, 300000),
			);

		if (candidates.length === 0) {
			return null;
		}

		return (
			candidates.find(candidate =>
				fileContainsWorktree(candidate, worktreePath),
			) ||
			candidates[0] ||
			null
		);
	}

	override async parseMessages(
		sessionFilePath: string,
	): Promise<ConversationMessage[]> {
		return parseOpencodeMessages(sessionFilePath);
	}

	override async extractMetadata(
		sessionFilePath: string,
	): Promise<SessionFileMetadata> {
		const messages = parseOpencodeMessages(sessionFilePath);
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
			model: messages.find(message => message.model)?.model,
		};
	}
}
