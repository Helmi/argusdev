import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {ClaudeAdapter} from './claude.js';
import {CodexAdapter} from './codex.js';
import {GenericAdapter} from './generic.js';

const tempDirs: string[] = [];

function makeTempFile(fileName: string, content: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), 'argusdev-conv-'));
	tempDirs.push(dir);
	const filePath = path.join(dir, fileName);
	writeFileSync(filePath, content, 'utf8');
	return filePath;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, {recursive: true, force: true});
	}
});

describe('conversation transcript adapters', () => {
	it('keeps Claude transcript parsing unchanged for messages, tools, and thinking', async () => {
		const filePath = makeTempFile(
			'claude-session.jsonl',
			[
				JSON.stringify({
					type: 'user',
					timestamp: '2026-04-14T10:00:00.000Z',
					message: 'Investigate the rendering bug',
				}),
				JSON.stringify({
					type: 'assistant',
					created_at: '2026-04-14T10:01:00.000Z',
					message: 'I found the parser mismatch.',
					model: 'claude-3-7-sonnet',
					thinking: 'Checking the transcript schema',
					tool_calls: [
						{
							name: 'read_file',
							input: {path: 'client/src/components/ConversationView.tsx'},
							output: 'file contents',
						},
					],
					usage: {total_tokens: 321},
				}),
			].join('\n'),
		);

		const adapter = new ClaudeAdapter();
		const messages = await adapter.parseMessages(filePath);
		const metadata = await adapter.extractMetadata(filePath);

		expect(messages).toHaveLength(2);
		expect(messages[1]).toMatchObject({
			role: 'assistant',
			content: 'I found the parser mismatch.',
			model: 'claude-3-7-sonnet',
			toolCalls: [
				{
					name: 'read_file',
					input: '{"path":"client/src/components/ConversationView.tsx"}',
					output: 'file contents',
				},
			],
			thinkingBlocks: [{content: 'Checking the transcript schema'}],
		});
		expect(metadata).toMatchObject({
			messageCount: 2,
			totalTokens: 321,
			model: 'claude-3-7-sonnet',
		});
	});

	it('parses current Codex payload-wrapped transcripts into renderable messages', async () => {
		const filePath = makeTempFile(
			'rollout-test.jsonl',
			[
				JSON.stringify({
					timestamp: '2026-04-14T10:00:00.000Z',
					type: 'session_meta',
					payload: {
						id: 'rollout-123',
						cwd: '/repo/.worktrees/feat-codex',
						model: 'gpt-5-codex',
					},
				}),
				JSON.stringify({
					timestamp: '2026-04-14T10:00:05.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'user',
						content: [
							{type: 'input_text', text: 'Open the conversations view'},
						],
					},
				}),
				JSON.stringify({
					timestamp: '2026-04-14T10:00:10.000Z',
					type: 'response_item',
					payload: {
						type: 'function_call',
						name: 'shell',
						arguments:
							'{"command":["bash","-lc","sed -n \\"1,40p\\" client/src/components/ConversationView.tsx"]}',
						call_id: 'call_1',
					},
				}),
				JSON.stringify({
					timestamp: '2026-04-14T10:00:11.000Z',
					type: 'response_item',
					payload: {
						type: 'function_call_output',
						call_id: 'call_1',
						output: '{"output":"component source"}',
					},
				}),
				JSON.stringify({
					timestamp: '2026-04-14T10:00:15.000Z',
					type: 'response_item',
					payload: {
						type: 'reasoning',
						summary: [
							{
								type: 'summary_text',
								text: '**Checking parser assumptions**',
							},
						],
						content: null,
					},
				}),
				JSON.stringify({
					timestamp: '2026-04-14T10:00:20.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'assistant',
						model: 'gpt-5-codex',
						content: [
							{type: 'output_text', text: 'The parser is Claude-specific.'},
						],
					},
				}),
			].join('\n'),
		);

		const adapter = new CodexAdapter();
		const messages = await adapter.parseMessages(filePath);
		const metadata = await adapter.extractMetadata(filePath);

		expect(messages).toHaveLength(5);
		expect(messages[0]).toMatchObject({
			role: 'user',
			content: 'Open the conversations view',
		});
		expect(messages[1]).toMatchObject({
			role: 'assistant',
			toolCalls: [
				{
					name: 'shell',
					input:
						'{"command":["bash","-lc","sed -n \\"1,40p\\" client/src/components/ConversationView.tsx"]}',
				},
			],
			rawType: 'function_call',
		});
		expect(messages[2]).toMatchObject({
			role: 'tool',
			content: '{"output":"component source"}',
			rawType: 'function_call_output',
		});
		expect(messages[3]).toMatchObject({
			role: 'system',
			content: '**Checking parser assumptions**',
			rawType: 'reasoning',
			thinkingBlocks: [{content: '**Checking parser assumptions**'}],
		});
		expect(messages[4]).toMatchObject({
			role: 'assistant',
			content: 'The parser is Claude-specific.',
			model: 'gpt-5-codex',
		});
		expect(metadata).toMatchObject({
			agentSessionId: 'rollout-123',
			messageCount: 5,
			model: 'gpt-5-codex',
		});
	});

	it('falls back to readable plain-text messages for unknown agents', async () => {
		const filePath = makeTempFile(
			'unknown.jsonl',
			[
				'plain text transcript line',
				JSON.stringify({
					timestamp: '2026-04-14T10:00:10.000Z',
					type: 'entry',
					message: 'plain text fallback line',
				}),
			].join('\n'),
		);

		const adapter = new GenericAdapter({
			id: 'mystery',
			name: 'Mystery Agent',
			kind: 'agent',
			command: 'mystery',
			options: [],
		});
		const messages = await adapter.parseMessages(filePath);
		const metadata = await adapter.extractMetadata(filePath);

		expect(messages).toHaveLength(2);
		expect(messages[0]?.content).toBe('plain text transcript line');
		expect(messages[1]).toMatchObject({
			content: 'plain text fallback line',
		});
		expect(metadata).toMatchObject({
			messageCount: 2,
		});
	});
});
