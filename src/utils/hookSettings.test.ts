import {describe, expect, it} from 'vitest';
import {buildClaudeHookSettings} from './hookSettings.js';

describe('buildClaudeHookSettings', () => {
	it('returns valid JSON', () => {
		const result = buildClaudeHookSettings(12345, 'session-abc');
		expect(() => JSON.parse(result)).not.toThrow();
	});

	it('generates correct hook structure with all events', () => {
		const settings = JSON.parse(buildClaudeHookSettings(9999, 'ses-1'));

		expect(settings.hooks).toBeDefined();
		expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
		expect(settings.hooks.PreToolUse).toHaveLength(1);
		expect(settings.hooks.Notification).toHaveLength(2);
		expect(settings.hooks.Stop).toHaveLength(1);
	});

	it('uses native http hook type', () => {
		const settings = JSON.parse(buildClaudeHookSettings(8080, 'ses-x'));
		const hook = settings.hooks.PreToolUse[0].hooks[0];

		expect(hook.type).toBe('http');
		expect(hook.url).toBeDefined();
		expect(hook.command).toBeUndefined();
	});

	it('maps Notification(permission_prompt) to waiting_input', () => {
		const settings = JSON.parse(buildClaudeHookSettings(8080, 'ses-x'));
		const permissionHook = settings.hooks.Notification.find(
			(h: {matcher: string}) => h.matcher === 'permission_prompt',
		);

		expect(permissionHook).toBeDefined();
		expect(permissionHook.hooks[0].url).toContain(
			'/hook-state/waiting_input',
		);
	});

	it('maps Notification(idle_prompt) to idle', () => {
		const settings = JSON.parse(buildClaudeHookSettings(8080, 'ses-x'));
		const idleHook = settings.hooks.Notification.find(
			(h: {matcher: string}) => h.matcher === 'idle_prompt',
		);

		expect(idleHook).toBeDefined();
		expect(idleHook.hooks[0].url).toContain('/hook-state/idle');
	});

	it('maps Stop to idle', () => {
		const settings = JSON.parse(buildClaudeHookSettings(8080, 'ses-x'));
		expect(settings.hooks.Stop[0].hooks[0].url).toContain(
			'/hook-state/idle',
		);
	});

	it('maps UserPromptSubmit to busy', () => {
		const settings = JSON.parse(buildClaudeHookSettings(8080, 'ses-x'));
		expect(settings.hooks.UserPromptSubmit[0].hooks[0].url).toContain(
			'/hook-state/busy',
		);
	});

	it('maps PreToolUse to busy', () => {
		const settings = JSON.parse(buildClaudeHookSettings(8080, 'ses-x'));
		expect(settings.hooks.PreToolUse[0].hooks[0].url).toContain(
			'/hook-state/busy',
		);
	});

	it('embeds port and session ID in URLs', () => {
		const settings = JSON.parse(
			buildClaudeHookSettings(54321, 'session-test-123'),
		);
		const url = settings.hooks.Stop[0].hooks[0].url;

		expect(url).toContain('127.0.0.1:54321');
		expect(url).toContain('/sessions/session-test-123/');
	});

	it('uses 127.0.0.1 instead of localhost', () => {
		const settings = JSON.parse(buildClaudeHookSettings(8080, 'ses'));
		const url = settings.hooks.Stop[0].hooks[0].url;

		expect(url).toMatch(/^http:\/\/127\.0\.0\.1:/);
		expect(url).not.toContain('localhost');
	});

	it('encodes session IDs with special characters', () => {
		const settings = JSON.parse(
			buildClaudeHookSettings(8080, 'session with spaces'),
		);
		const url = settings.hooks.Stop[0].hooks[0].url;

		expect(url).toContain('session%20with%20spaces');
	});
});
