import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ClaudeAdapter} from './claude.js';
import {ClineAdapter} from './cline.js';
import {CodexAdapter} from './codex.js';
import {GeminiAdapter} from './gemini.js';
import {GenericAdapter} from './generic.js';

let geminiTmpRoot = '';

vi.mock('./helpers.js', async importOriginal => {
	const original = await importOriginal<typeof import('./helpers.js')>();
	return {
		...original,
		homePath: (...parts: string[]) =>
			geminiTmpRoot
				? path.join(geminiTmpRoot, ...parts)
				: original.homePath(...parts),
	};
});

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

	it('parses Codex event_msg-based transcripts with correct roles and deduplication', async () => {
		const filePath = makeTempFile(
			'rollout-test.jsonl',
			[
				// session_meta — skipped
				JSON.stringify({
					timestamp: '2026-04-14T10:00:00.000Z',
					type: 'session_meta',
					payload: {
						id: 'rollout-123',
						cwd: '/repo/.worktrees/feat-codex',
						model: 'gpt-5-codex',
					},
				}),
				// response_item/message — skipped (duplicated by event_msg/user_message)
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
				// event_msg/user_message — canonical user input
				JSON.stringify({
					timestamp: '2026-04-14T10:00:05.000Z',
					type: 'event_msg',
					payload: {
						type: 'user_message',
						message: 'Open the conversations view',
					},
				}),
				// response_item/reasoning — kept (no event_msg equivalent)
				JSON.stringify({
					timestamp: '2026-04-14T10:00:10.000Z',
					type: 'response_item',
					payload: {
						type: 'reasoning',
						summary: [
							{type: 'summary_text', text: '**Checking parser assumptions**'},
						],
						content: null,
					},
				}),
				// response_item/function_call — kept
				JSON.stringify({
					timestamp: '2026-04-14T10:00:12.000Z',
					type: 'response_item',
					payload: {
						type: 'function_call',
						name: 'shell',
						arguments:
							'{"command":["bash","-lc","sed -n \\"1,40p\\" client/src/components/ConversationView.tsx"]}',
						call_id: 'call_1',
					},
				}),
				// response_item/function_call_output — kept
				JSON.stringify({
					timestamp: '2026-04-14T10:00:13.000Z',
					type: 'response_item',
					payload: {
						type: 'function_call_output',
						call_id: 'call_1',
						output: '{"output":"component source"}',
					},
				}),
				// response_item/message role=assistant — skipped (duplicated by event_msg/agent_message)
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
				// event_msg/agent_message — canonical assistant reply
				JSON.stringify({
					timestamp: '2026-04-14T10:00:20.000Z',
					type: 'event_msg',
					payload: {
						type: 'agent_message',
						message: 'The parser is Claude-specific.',
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
			rawType: 'user_message',
		});
		expect(messages[1]).toMatchObject({
			role: 'system',
			content: '**Checking parser assumptions**',
			rawType: 'reasoning',
			thinkingBlocks: [{content: '**Checking parser assumptions**'}],
		});
		expect(messages[2]).toMatchObject({
			role: 'assistant',
			rawType: 'function_call',
			toolCalls: [
				{
					name: 'shell',
					input:
						'{"command":["bash","-lc","sed -n \\"1,40p\\" client/src/components/ConversationView.tsx"]}',
				},
			],
		});
		expect(messages[3]).toMatchObject({
			role: 'tool',
			content: '{"output":"component source"}',
			rawType: 'function_call_output',
		});
		expect(messages[4]).toMatchObject({
			role: 'assistant',
			content: 'The parser is Claude-specific.',
			rawType: 'agent_message',
		});
		expect(metadata).toMatchObject({
			agentSessionId: 'rollout-123',
			messageCount: 5,
			model: 'gpt-5-codex',
		});
	});

	it('renders legacy Codex transcripts that have no event_msg rows', async () => {
		// Older Codex CLI versions only wrote response_item/message rows.
		// The dedup logic must not drop them when no event_msg twin exists.
		const filePath = makeTempFile(
			'rollout-legacy.jsonl',
			[
				JSON.stringify({
					timestamp: '2026-01-10T09:00:00.000Z',
					type: 'session_meta',
					payload: {id: 'legacy-session', cwd: '/repo'},
				}),
				JSON.stringify({
					timestamp: '2026-01-10T09:00:05.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'user',
						content: [{type: 'input_text', text: 'Fix the bug in parser.ts'}],
					},
				}),
				JSON.stringify({
					timestamp: '2026-01-10T09:00:20.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'assistant',
						content: [
							{type: 'output_text', text: 'Done — fixed the off-by-one.'},
						],
					},
				}),
			].join('\n'),
		);

		const adapter = new CodexAdapter();
		const messages = await adapter.parseMessages(filePath);

		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({
			role: 'user',
			content: 'Fix the bug in parser.ts',
		});
		expect(messages[1]).toMatchObject({
			role: 'assistant',
			content: 'Done — fixed the off-by-one.',
		});
	});

	it('filters prompt-blob noise from legacy Codex response_item/message rows', async () => {
		// developer/system roles and known user prompt-blob prefixes must be dropped.
		// Real user turns — including ones starting with '<' — must pass through.
		const filePath = makeTempFile(
			'rollout-legacy-prompts.jsonl',
			[
				JSON.stringify({
					timestamp: '2026-01-10T09:00:00.000Z',
					type: 'session_meta',
					payload: {id: 'legacy-prompts', cwd: '/repo'},
				}),
				// developer role — permissions preamble, must be filtered
				JSON.stringify({
					timestamp: '2026-01-10T09:00:01.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'developer',
						content: [
							{
								type: 'input_text',
								text: '<permissions instructions>sandbox_mode is danger-full-access',
							},
						],
					},
				}),
				// system role — defensive filter, must be filtered
				JSON.stringify({
					timestamp: '2026-01-10T09:00:02.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'system',
						content: [
							{type: 'input_text', text: 'You are a helpful assistant.'},
						],
					},
				}),
				// user row: <user_instructions> blob, must be filtered
				JSON.stringify({
					timestamp: '2026-01-10T09:00:03.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: '<user_instructions>\n# Project guidelines\n',
							},
						],
					},
				}),
				// user row: <environment_context> blob, must be filtered
				JSON.stringify({
					timestamp: '2026-01-10T09:00:04.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: '<environment_context>\n  <cwd>/repo</cwd>\n',
							},
						],
					},
				}),
				// user row: <permissions instructions> blob, must be filtered
				JSON.stringify({
					timestamp: '2026-01-10T09:00:05.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: '<permissions instructions>workspace-write sandbox',
							},
						],
					},
				}),
				// user row: AGENTS.md blob, must be filtered
				JSON.stringify({
					timestamp: '2026-01-10T09:00:06.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>',
							},
						],
					},
				}),
				// real user turn starting with '<' — must NOT be filtered (discriminator safety)
				JSON.stringify({
					timestamp: '2026-01-10T09:00:07.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: '<MyComponent> renders incorrectly — can you fix it?',
							},
						],
					},
				}),
				// real assistant reply
				JSON.stringify({
					timestamp: '2026-01-10T09:00:20.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'assistant',
						content: [
							{type: 'output_text', text: 'Fixed the component render.'},
						],
					},
				}),
			].join('\n'),
		);

		const adapter = new CodexAdapter();
		const messages = await adapter.parseMessages(filePath);

		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({
			role: 'user',
			content: '<MyComponent> renders incorrectly — can you fix it?',
		});
		expect(messages[1]).toMatchObject({
			role: 'assistant',
			content: 'Fixed the component render.',
		});
	});

	it('filters prompt-blob noise from legacy Codex response_item top-level shape rows', async () => {
		// Rows using the row.response_item top-level key (not row.payload) must also
		// be caught by the filter. getCodexPayload resolves both envelope shapes.
		const filePath = makeTempFile(
			'rollout-legacy-ri-toplevel.jsonl',
			[
				JSON.stringify({
					timestamp: '2026-01-10T09:00:00.000Z',
					type: 'session_meta',
					payload: {id: 'legacy-ri', cwd: '/repo'},
				}),
				// response_item top-level shape: developer role — must be filtered
				JSON.stringify({
					timestamp: '2026-01-10T09:00:01.000Z',
					type: 'response_item',
					response_item: {
						type: 'message',
						role: 'developer',
						content: [
							{type: 'input_text', text: '<permissions instructions>sandbox'},
						],
					},
				}),
				// response_item top-level shape: user prompt-blob — must be filtered
				JSON.stringify({
					timestamp: '2026-01-10T09:00:02.000Z',
					type: 'response_item',
					response_item: {
						type: 'message',
						role: 'user',
						content: [
							{
								type: 'input_text',
								text: '<user_instructions>\n# Project guidelines\n',
							},
						],
					},
				}),
				// response_item top-level shape: real user turn — must pass through
				JSON.stringify({
					timestamp: '2026-01-10T09:00:03.000Z',
					type: 'response_item',
					response_item: {
						type: 'message',
						role: 'user',
						content: [{type: 'input_text', text: 'Fix the parser bug.'}],
					},
				}),
				// payload: shape still works — must pass through (regression guard)
				JSON.stringify({
					timestamp: '2026-01-10T09:00:04.000Z',
					type: 'response_item',
					payload: {
						type: 'message',
						role: 'assistant',
						content: [{type: 'output_text', text: 'Done.'}],
					},
				}),
			].join('\n'),
		);

		const adapter = new CodexAdapter();
		const messages = await adapter.parseMessages(filePath);

		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({
			role: 'user',
			content: 'Fix the parser bug.',
		});
		expect(messages[1]).toMatchObject({
			role: 'assistant',
			content: 'Done.',
		});
	});

	it('parses Gemini CLI JSONL transcripts with thoughts as thinking blocks', async () => {
		const filePath = makeTempFile(
			'session-2026-04-25T18-59-abcd1234.jsonl',
			[
				// session header — skipped
				JSON.stringify({
					sessionId: 'abcd1234-session',
					projectHash: 'abc123',
					startTime: '2026-04-25T18:59:26.441Z',
					lastUpdated: '2026-04-25T18:59:26.441Z',
					kind: 'main',
				}),
				// user message with content as array
				JSON.stringify({
					id: 'msg-1',
					timestamp: '2026-04-25T18:59:27.040Z',
					type: 'user',
					content: [{text: 'What are the risks in this codebase?'}],
				}),
				// $set mutation — skipped
				JSON.stringify({$set: {lastUpdated: '2026-04-25T18:59:27.040Z'}}),
				// gemini response with thoughts and string content
				JSON.stringify({
					id: 'msg-2',
					timestamp: '2026-04-25T18:59:45.000Z',
					type: 'gemini',
					content:
						'The main risks are open redirects and missing CSRF protection.',
					thoughts: [
						{
							subject: 'Analyzing security surface',
							description: 'Reviewing auth routes for common vulnerabilities.',
						},
					],
					model: 'gemini-2.5-pro',
					tokens: 1500,
				}),
			].join('\n'),
		);

		const adapter = new GeminiAdapter();
		const messages = await adapter.parseMessages(filePath);
		const metadata = await adapter.extractMetadata(filePath);

		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({
			role: 'user',
			content: 'What are the risks in this codebase?',
			rawType: 'user',
		});
		expect(messages[1]).toMatchObject({
			role: 'assistant',
			content: 'The main risks are open redirects and missing CSRF protection.',
			model: 'gemini-2.5-pro',
			rawType: 'gemini',
			thinkingBlocks: [
				{content: 'Reviewing auth routes for common vulnerabilities.'},
			],
		});
		expect(metadata).toMatchObject({
			messageCount: 2,
			model: 'gemini-2.5-pro',
			totalTokens: 1500,
		});
	});

	it('returns an explicit unsupported message for Cline sessions', async () => {
		const adapter = new ClineAdapter();
		const messages = await adapter.parseMessages('');

		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			role: 'system',
			rawType: 'unsupported',
		});
		expect(messages[0]?.content).toContain('not yet supported');
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

describe('GeminiAdapter.findSessionFile scoping', () => {
	let tmpRoot = '';

	afterEach(() => {
		geminiTmpRoot = '';
		if (tmpRoot) {
			rmSync(tmpRoot, {recursive: true, force: true});
			tmpRoot = '';
		}
	});

	it('td-ae12f7: returns only the file whose projectHash matches the worktree path', async () => {
		tmpRoot = mkdtempSync(path.join(tmpdir(), 'argusdev-gemini-scope-'));
		geminiTmpRoot = tmpRoot;

		const worktreeA = '/fake/proj-alpha';
		const worktreeB = '/fake/proj-beta';
		const hashA = createHash('sha256').update(worktreeA).digest('hex');
		const hashB = createHash('sha256').update(worktreeB).digest('hex');

		// Create two project dirs under the mocked ~/.gemini/tmp
		const geminiTmp = path.join(tmpRoot, '.gemini', 'tmp');
		const dirA = path.join(geminiTmp, 'proj-alpha', 'chats');
		const dirB = path.join(geminiTmp, 'proj-beta', 'chats');
		mkdirSync(dirA, {recursive: true});
		mkdirSync(dirB, {recursive: true});

		// Write session file for worktreeA (older mtime — would lose on global sort)
		const fileA = path.join(dirA, 'session-2026-01-01T10-00-aabbccdd.jsonl');
		writeFileSync(
			fileA,
			JSON.stringify({projectHash: hashA, kind: 'main'}) + '\n',
			'utf8',
		);

		// Write session file for worktreeB (newer mtime — wins on global sort)
		const fileB = path.join(dirB, 'session-2026-01-01T11-00-eeff0011.jsonl');
		writeFileSync(
			fileB,
			JSON.stringify({projectHash: hashB, kind: 'main'}) + '\n',
			'utf8',
		);

		const adapter = new GeminiAdapter();
		// findSessionFile for worktreeA must return fileA, not fileB (the newer one)
		const found = await adapter.findSessionFile(worktreeA);
		expect(found).toBe(fileA);

		// Symmetric: findSessionFile for worktreeB must return fileB
		const foundB = await adapter.findSessionFile(worktreeB);
		expect(foundB).toBe(fileB);
	});
});
