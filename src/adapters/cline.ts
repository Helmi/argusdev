import {BaseAgentAdapter} from './base.js';
import type {ConversationMessage} from './types.js';

export class ClineAdapter extends BaseAgentAdapter {
	constructor() {
		super({
			id: 'cline',
			name: 'Cline',
			icon: 'bot',
			command: 'cline',
			detectionStrategy: 'cline',
			sessionFormat: 'none',
		});
	}

	override async parseMessages(
		_sessionFilePath: string,
	): Promise<ConversationMessage[]> {
		return [
			{
				id: 'cline-unsupported',
				role: 'system',
				timestamp: null,
				content:
					"Cline stores transcripts inside the VS Code extension's internal storage which is not accessible outside VS Code. Conversation history is not yet supported for this agent.",
				preview: "Cline transcripts aren't supported yet",
				rawType: 'unsupported',
			},
		];
	}
}
