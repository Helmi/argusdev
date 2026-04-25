import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

let configDirOverride = '';
vi.mock('./configDir.js', () => ({
	getConfigDir: () => configDirOverride,
}));

const {
	buildClaudeHookSettings,
	cleanupHookSettingsFile,
	sweepOrphanHookSettings,
	writeHookSettingsFile,
} = await import('./hookSettings.js');

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
		expect(permissionHook.hooks[0].url).toContain('/hook-state/waiting_input');
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
		expect(settings.hooks.Stop[0].hooks[0].url).toContain('/hook-state/idle');
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

describe('hook settings persistence', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'argusdev-hooks-test-'));
		configDirOverride = dir;
	});

	afterEach(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	it('writes hook settings under <configDir>/hooks/<id>.json', () => {
		const path = writeHookSettingsFile(8080, 'sess-1');

		expect(path).toBe(join(dir, 'hooks', 'sess-1.json'));
		expect(existsSync(path)).toBe(true);
		expect(JSON.parse(readFileSync(path, 'utf-8')).hooks).toBeDefined();
	});

	it('writes file with mode 0600', () => {
		const path = writeHookSettingsFile(8080, 'sess-mode');
		const mode = statSync(path).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it('overwrites atomically when re-written', () => {
		const path = writeHookSettingsFile(8080, 'sess-rewrite');
		writeHookSettingsFile(9090, 'sess-rewrite');

		const settings = JSON.parse(readFileSync(path, 'utf-8'));
		expect(settings.hooks.Stop[0].hooks[0].url).toContain(':9090');
		expect(existsSync(`${path}.tmp`)).toBe(false);
	});

	it('cleanup removes the file and tolerates a missing one', () => {
		const path = writeHookSettingsFile(8080, 'sess-clean');
		expect(existsSync(path)).toBe(true);

		cleanupHookSettingsFile('sess-clean');
		expect(existsSync(path)).toBe(false);

		expect(() => cleanupHookSettingsFile('sess-clean')).not.toThrow();
	});

	it('sweeps orphan files and keeps live ones', () => {
		writeHookSettingsFile(8080, 'live-1');
		writeHookSettingsFile(8080, 'orphan-1');
		writeHookSettingsFile(8080, 'orphan-2');
		// Stray non-json file must be ignored
		writeFileSync(join(dir, 'hooks', 'README'), 'ignore me');

		const removed = sweepOrphanHookSettings(new Set(['live-1']));

		expect(removed).toBe(2);
		expect(existsSync(join(dir, 'hooks', 'live-1.json'))).toBe(true);
		expect(existsSync(join(dir, 'hooks', 'orphan-1.json'))).toBe(false);
		expect(existsSync(join(dir, 'hooks', 'orphan-2.json'))).toBe(false);
		expect(existsSync(join(dir, 'hooks', 'README'))).toBe(true);
	});

	it('sweep returns 0 when hooks dir does not exist yet', () => {
		expect(sweepOrphanHookSettings(new Set())).toBe(0);
	});
});
