import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	existsSync,
	mkdirSync,
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
	buildCodexHookConfig,
	cleanupCodexHookFiles,
	cleanupHookSettingsFile,
	sweepOrphanHookSettings,
	writeCodexHookFiles,
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

// ── Codex hook config ─────────────────────────────────────────────────────────

describe('buildCodexHookConfig', () => {
	it('returns valid JSON', () => {
		expect(() =>
			JSON.parse(buildCodexHookConfig(9999, 'ses-codex')),
		).not.toThrow();
	});

	it('generates all five hook events', () => {
		const cfg = JSON.parse(buildCodexHookConfig(9999, 'ses-codex'));
		expect(cfg.hooks.SessionStart).toHaveLength(1);
		expect(cfg.hooks.UserPromptSubmit).toHaveLength(1);
		expect(cfg.hooks.PreToolUse).toHaveLength(1);
		expect(cfg.hooks.PermissionRequest).toHaveLength(1);
		expect(cfg.hooks.Stop).toHaveLength(1);
	});

	it('uses nested wrapper shape with type:command (not flat command field)', () => {
		// Codex schema: EventName: [{ hooks: [{ type: "command", command: "..." }] }]
		const cfg = JSON.parse(buildCodexHookConfig(8080, 'ses-x'));
		const entry = cfg.hooks.Stop[0];
		expect(entry.command).toBeUndefined();
		expect(entry.hooks).toHaveLength(1);
		expect(entry.hooks[0].type).toBe('command');
		expect(entry.hooks[0].command).toContain('curl');
	});

	it('PreToolUse has matcher:Bash and correct nested shape', () => {
		const cfg = JSON.parse(buildCodexHookConfig(8080, 'ses-x'));
		const entry = cfg.hooks.PreToolUse[0];
		expect(entry.matcher).toBe('Bash');
		expect(entry.hooks[0].type).toBe('command');
		expect(entry.hooks[0].command).toContain('/hook-state/busy');
	});

	it('maps UserPromptSubmit to busy', () => {
		const cfg = JSON.parse(buildCodexHookConfig(8080, 'ses-x'));
		expect(cfg.hooks.UserPromptSubmit[0].hooks[0].command).toContain(
			'/hook-state/busy',
		);
	});

	it('maps PermissionRequest to waiting_input', () => {
		const cfg = JSON.parse(buildCodexHookConfig(8080, 'ses-x'));
		expect(cfg.hooks.PermissionRequest[0].hooks[0].command).toContain(
			'/hook-state/waiting_input',
		);
	});

	it('maps Stop to idle', () => {
		const cfg = JSON.parse(buildCodexHookConfig(8080, 'ses-x'));
		expect(cfg.hooks.Stop[0].hooks[0].command).toContain('/hook-state/idle');
	});

	it('matches exact nested shape for Stop event', () => {
		const cfg = JSON.parse(buildCodexHookConfig(8080, 'ses-x'));
		expect(cfg.hooks.Stop).toEqual([
			{
				hooks: [
					{
						type: 'command',
						command: expect.stringContaining('/hook-state/idle'),
					},
				],
			},
		]);
	});

	it('embeds port and session ID in commands', () => {
		const cfg = JSON.parse(buildCodexHookConfig(54321, 'session-test-xyz'));
		const cmd = cfg.hooks.Stop[0].hooks[0].command;
		expect(cmd).toContain('127.0.0.1:54321');
		expect(cmd).toContain('/sessions/session-test-xyz/');
	});

	it('encodes session IDs with special characters', () => {
		const cfg = JSON.parse(buildCodexHookConfig(8080, 'session with spaces'));
		const cmd = cfg.hooks.Stop[0].hooks[0].command;
		expect(cmd).toContain('session%20with%20spaces');
	});
});

describe('writeCodexHookFiles', () => {
	let worktree: string;

	beforeEach(() => {
		worktree = mkdtempSync(join(tmpdir(), 'argusdev-codex-test-'));
	});

	afterEach(() => {
		rmSync(worktree, {recursive: true, force: true});
	});

	it('writes hooks.json in <worktree>/.codex/', () => {
		writeCodexHookFiles(worktree, 8080, 'ses-1');
		const hooksPath = join(worktree, '.codex', 'hooks.json');
		expect(existsSync(hooksPath)).toBe(true);
		expect(JSON.parse(readFileSync(hooksPath, 'utf-8')).hooks).toBeDefined();
	});

	it('writes hooks.json with mode 0600', () => {
		writeCodexHookFiles(worktree, 8080, 'ses-mode');
		const mode = statSync(join(worktree, '.codex', 'hooks.json')).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it('creates .codex/config.toml with [features] codex_hooks = true when absent', () => {
		writeCodexHookFiles(worktree, 8080, 'ses-cfg');
		const content = readFileSync(
			join(worktree, '.codex', 'config.toml'),
			'utf-8',
		);
		expect(content).toContain('codex_hooks = true');
		expect(content).toContain('[features]');
	});

	it('appends codex_hooks under existing [features] section', () => {
		const codexDir = join(worktree, '.codex');
		mkdirSync(codexDir, {recursive: true});
		writeFileSync(
			join(codexDir, 'config.toml'),
			'model = "gpt-4o"\n\n[features]\nunified_exec = true\n',
		);
		writeCodexHookFiles(worktree, 8080, 'ses-patch');
		const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8');
		expect(content).toContain('codex_hooks = true');
		expect(content).toContain('unified_exec = true');
	});

	it('sets codex_hooks = true when it already exists as false', () => {
		const codexDir = join(worktree, '.codex');
		mkdirSync(codexDir, {recursive: true});
		writeFileSync(
			join(codexDir, 'config.toml'),
			'[features]\ncodex_hooks = false\n',
		);
		writeCodexHookFiles(worktree, 8080, 'ses-update');
		const content = readFileSync(join(codexDir, 'config.toml'), 'utf-8');
		expect(content).toContain('codex_hooks = true');
		expect(content).not.toContain('codex_hooks = false');
	});

	it('is idempotent when called twice', () => {
		writeCodexHookFiles(worktree, 8080, 'ses-idem');
		writeCodexHookFiles(worktree, 9090, 'ses-idem');
		const content = readFileSync(
			join(worktree, '.codex', 'hooks.json'),
			'utf-8',
		);
		expect(JSON.parse(content).hooks.Stop[0].hooks[0].command).toContain(
			':9090',
		);
	});

	it('cleanup fn removes hooks.json when none pre-existed', () => {
		const cleanup = writeCodexHookFiles(worktree, 8080, 'ses-clean');
		const hooksPath = join(worktree, '.codex', 'hooks.json');
		expect(existsSync(hooksPath)).toBe(true);
		cleanup();
		expect(existsSync(hooksPath)).toBe(false);
	});

	it('cleanup fn restores pre-existing hooks.json', () => {
		const codexDir = join(worktree, '.codex');
		mkdirSync(codexDir, {recursive: true});
		const originalHooks = JSON.stringify({
			hooks: {MyEvent: [{command: 'echo hi'}]},
		});
		writeFileSync(join(codexDir, 'hooks.json'), originalHooks, {
			encoding: 'utf-8',
		});

		const cleanup = writeCodexHookFiles(worktree, 8080, 'ses-restore');
		// ArgusDev hooks are now active
		const active = readFileSync(join(codexDir, 'hooks.json'), 'utf-8');
		expect(JSON.parse(active).hooks.Stop).toBeDefined();

		cleanup();
		// Original file is restored
		const restored = readFileSync(join(codexDir, 'hooks.json'), 'utf-8');
		expect(restored).toBe(originalHooks);
		// Backup file is gone
		expect(existsSync(join(codexDir, 'hooks.json.argusdev-backup'))).toBe(
			false,
		);
	});

	it('cleanup fn removes config.toml when it did not exist before', () => {
		const cleanup = writeCodexHookFiles(worktree, 8080, 'ses-cfg-clean');
		const configPath = join(worktree, '.codex', 'config.toml');
		expect(existsSync(configPath)).toBe(true);
		cleanup();
		expect(existsSync(configPath)).toBe(false);
	});

	it('cleanup fn restores original config.toml content', () => {
		const codexDir = join(worktree, '.codex');
		mkdirSync(codexDir, {recursive: true});
		const originalConfig = 'model = "gpt-4o"\n';
		writeFileSync(join(codexDir, 'config.toml'), originalConfig);

		const cleanup = writeCodexHookFiles(worktree, 8080, 'ses-cfg-restore');
		cleanup();
		expect(readFileSync(join(codexDir, 'config.toml'), 'utf-8')).toBe(
			originalConfig,
		);
	});

	it('cleanupCodexHookFiles removes hooks.json and tolerates missing file', () => {
		writeCodexHookFiles(worktree, 8080, 'ses-legacy-clean');
		const hooksPath = join(worktree, '.codex', 'hooks.json');
		expect(existsSync(hooksPath)).toBe(true);
		cleanupCodexHookFiles(worktree);
		expect(existsSync(hooksPath)).toBe(false);
		expect(() => cleanupCodexHookFiles(worktree)).not.toThrow();
	});
});
