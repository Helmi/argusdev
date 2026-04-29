import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

let configDirOverride = '';
let piSettingsDirOverride = '';

vi.mock('./configDir.js', () => ({
	getConfigDir: () => configDirOverride,
}));

vi.mock('../adapters/helpers.js', () => ({
	homePath: (...parts: string[]) => join(piSettingsDirOverride, ...parts),
}));

const {
	buildClaudeHookSettings,
	buildCodexHookConfig,
	buildGeminiHookConfig,
	buildOpencodePluginContent,
	cleanupCodexHookFiles,
	cleanupHookSettingsFile,
	sweepOrphanHookSettings,
	writeCodexHookFiles,
	writeGeminiHookFiles,
	writeHookSettingsFile,
	writeOpencodePluginFile,
	writePiExtensionSettings,
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

	it('td-65c5ff: does not overwrite backup when one already exists (crash-recovery guard)', () => {
		// Simulate a daemon crash mid-session: backup exists from the first
		// session start, but hooks.json currently holds ArgusDev content.
		const codexDir = join(worktree, '.codex');
		mkdirSync(codexDir, {recursive: true});
		const hooksPath = join(codexDir, 'hooks.json');
		const backupPath = `${hooksPath}.argusdev-backup`;
		const originalHooks = JSON.stringify({
			hooks: {MyEvent: [{command: 'echo original'}]},
		});
		const survivedHooks = JSON.stringify({
			hooks: {MyEvent: [{command: 'echo survived'}]},
		});

		// Pre-existing backup contains the user's original file
		writeFileSync(backupPath, originalHooks, {encoding: 'utf-8'});
		// hooks.json currently contains the last ArgusDev-written content
		writeFileSync(hooksPath, survivedHooks, {encoding: 'utf-8'});

		// Second call (new session start after crash) must not clobber the backup
		const cleanup = writeCodexHookFiles(worktree, 8080, 'ses-crash-recovery');

		expect(readFileSync(backupPath, 'utf-8')).toBe(originalHooks);

		cleanup();
		// After cleanup, original is restored
		expect(readFileSync(hooksPath, 'utf-8')).toBe(originalHooks);
		expect(existsSync(backupPath)).toBe(false);
	});

	it('td-286f20: skips config.toml revert when file was modified mid-session', () => {
		const codexDir = join(worktree, '.codex');
		mkdirSync(codexDir, {recursive: true});
		const configPath = join(codexDir, 'config.toml');
		const originalConfig = 'model = "gpt-4o"\n';
		writeFileSync(configPath, originalConfig);

		const cleanup = writeCodexHookFiles(worktree, 8080, 'ses-mid-edit');

		// User edits config.toml during the session
		const userEdited = 'model = "o4-mini"\n\n[features]\ncodex_hooks = true\n';
		writeFileSync(configPath, userEdited, {encoding: 'utf-8'});

		cleanup();

		// Cleanup must preserve the user's mid-session edits
		expect(readFileSync(configPath, 'utf-8')).toBe(userEdited);
	});

	it('td-286f20 symmetric: skips config.toml unlink when ArgusDev created it but user modified it', () => {
		// No pre-existing config.toml — ArgusDev creates it
		const cleanup = writeCodexHookFiles(worktree, 8080, 'ses-fresh-edit');
		const configPath = join(worktree, '.codex', 'config.toml');
		expect(existsSync(configPath)).toBe(true);

		// User adds settings during the session
		const userEdited = '[features]\ncodex_hooks = true\n\nmodel = "o4-mini"\n';
		writeFileSync(configPath, userEdited, {encoding: 'utf-8'});

		cleanup();

		// File must survive — user edits take precedence over cleanup unlink
		expect(existsSync(configPath)).toBe(true);
		expect(readFileSync(configPath, 'utf-8')).toBe(userEdited);
	});
});

// ── OpenCode plugin ───────────────────────────────────────────────────────────

describe('buildOpencodePluginContent', () => {
	it('returns valid JS with a named server export', () => {
		const content = buildOpencodePluginContent(8080, 'ses-oc');
		expect(content).toContain('export const server');
	});

	it('embeds port and session ID in fetch URLs', () => {
		const content = buildOpencodePluginContent(54321, 'ses-oc-123');
		expect(content).toContain('127.0.0.1:54321');
		expect(content).toContain('/sessions/ses-oc-123/');
	});

	it('encodes session IDs with special characters', () => {
		const content = buildOpencodePluginContent(8080, 'session with spaces');
		expect(content).toContain('session%20with%20spaces');
	});

	it('includes tool.execute.before mapping to busy', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		expect(content).toContain('"tool.execute.before"');
		expect(content).toContain('/hook-state/busy');
	});

	it('tool.execute.before does not return output (void)', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		const toolBlock = content.slice(
			content.indexOf('"tool.execute.before"'),
			content.indexOf('"permission.ask"'),
		);
		expect(toolBlock).not.toContain('return output');
	});

	it('includes permission.ask mapping to waiting_input', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		expect(content).toContain('"permission.ask"');
		expect(content).toContain('/hook-state/waiting_input');
	});

	it('includes event handler mapping session.idle to idle', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		expect(content).toContain('event');
		expect(content).toContain('session.idle');
		expect(content).toContain('/hook-state/idle');
	});

	it('includes session.status idle mapping', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		expect(content).toContain('session.status');
		expect(content).toContain('"idle"');
	});

	it('includes session.status busy mapping for pure-chat responses', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		expect(content).toContain('"busy"');
		const busyCount = (content.match(/hook-state\/busy/g) || []).length;
		expect(busyCount).toBeGreaterThanOrEqual(2);
	});

	it('maps question.asked bus event to waiting_input', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		expect(content).toContain('question.asked');
		expect(content).toContain('/hook-state/waiting_input');
		// Verify it appears inside the event handler (after "event:")
		const eventIdx = content.indexOf('event: async');
		const questionAskedIdx = content.indexOf('question.asked');
		expect(questionAskedIdx).toBeGreaterThan(eventIdx);
	});

	it('maps question.replied bus event to busy', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		expect(content).toContain('question.replied');
	});

	it('maps question.rejected bus event to busy', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		expect(content).toContain('question.rejected');
	});

	it('question.replied and question.rejected both post to busy', () => {
		const content = buildOpencodePluginContent(8080, 'ses');
		const repliedIdx = content.indexOf('question.replied');
		const rejectedIdx = content.indexOf('question.rejected');
		// Both are in the same else-if branch followed by a single busy POST
		const branchEnd = content.indexOf('/hook-state/busy', repliedIdx);
		expect(branchEnd).toBeGreaterThan(repliedIdx);
		expect(branchEnd).toBeGreaterThan(rejectedIdx);
	});
});

describe('writeOpencodePluginFile', () => {
	let worktree: string;

	beforeEach(() => {
		worktree = mkdtempSync(join(tmpdir(), 'argusdev-opencode-test-'));
	});

	afterEach(() => {
		rmSync(worktree, {recursive: true, force: true});
	});

	it('writes plugin file in <worktree>/.opencode/plugins/', () => {
		writeOpencodePluginFile(worktree, 8080, 'ses-1');
		const pluginPath = join(
			worktree,
			'.opencode',
			'plugins',
			'argusdev-state.js',
		);
		expect(existsSync(pluginPath)).toBe(true);
		expect(readFileSync(pluginPath, 'utf-8')).toContain('export const server');
	});

	it('writes plugin file with mode 0600', () => {
		writeOpencodePluginFile(worktree, 8080, 'ses-mode');
		const pluginPath = join(
			worktree,
			'.opencode',
			'plugins',
			'argusdev-state.js',
		);
		const mode = statSync(pluginPath).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it('creates .opencode/plugins/ when absent', () => {
		expect(existsSync(join(worktree, '.opencode', 'plugins'))).toBe(false);
		writeOpencodePluginFile(worktree, 8080, 'ses-dir');
		expect(existsSync(join(worktree, '.opencode', 'plugins'))).toBe(true);
	});

	it('cleanup fn removes plugin file', () => {
		const cleanup = writeOpencodePluginFile(worktree, 8080, 'ses-clean');
		const pluginPath = join(
			worktree,
			'.opencode',
			'plugins',
			'argusdev-state.js',
		);
		expect(existsSync(pluginPath)).toBe(true);
		cleanup();
		expect(existsSync(pluginPath)).toBe(false);
	});

	it('cleanup fn removes plugins dir when ArgusDev created it', () => {
		const cleanup = writeOpencodePluginFile(worktree, 8080, 'ses-rmdir');
		cleanup();
		expect(existsSync(join(worktree, '.opencode', 'plugins'))).toBe(false);
	});

	it('cleanup fn leaves plugins dir when it pre-existed', () => {
		const pluginsDir = join(worktree, '.opencode', 'plugins');
		mkdirSync(pluginsDir, {recursive: true});
		writeFileSync(join(pluginsDir, 'user-plugin.js'), '// user plugin');

		const cleanup = writeOpencodePluginFile(worktree, 8080, 'ses-keep');
		cleanup();

		expect(existsSync(pluginsDir)).toBe(true);
		expect(existsSync(join(pluginsDir, 'user-plugin.js'))).toBe(true);
	});

	it('does not stomp user plugins when dir pre-existed', () => {
		const pluginsDir = join(worktree, '.opencode', 'plugins');
		mkdirSync(pluginsDir, {recursive: true});
		const userPlugin = join(pluginsDir, 'my-plugin.js');
		writeFileSync(userPlugin, '// mine');

		writeOpencodePluginFile(worktree, 8080, 'ses-nostop');

		expect(readFileSync(userPlugin, 'utf-8')).toBe('// mine');
	});

	it('is idempotent — second call overwrites with new session params', () => {
		writeOpencodePluginFile(worktree, 8080, 'ses-first');
		writeOpencodePluginFile(worktree, 9090, 'ses-second');
		const content = readFileSync(
			join(worktree, '.opencode', 'plugins', 'argusdev-state.js'),
			'utf-8',
		);
		expect(content).toContain(':9090');
		expect(content).toContain('ses-second');
	});

	it('cleanup does not remove non-empty plugins dir it created', () => {
		const cleanup = writeOpencodePluginFile(worktree, 8080, 'ses-nonempty');
		const pluginsDir = join(worktree, '.opencode', 'plugins');
		writeFileSync(join(pluginsDir, 'other.js'), '// other');
		cleanup();
		expect(existsSync(pluginsDir)).toBe(true);
	});
});

// ── Pi extension settings ─────────────────────────────────────────────────────

describe('writePiExtensionSettings', () => {
	let piHome: string;
	const hookPath = '/path/to/dist/hooks/piHook.js';

	beforeEach(() => {
		piHome = mkdtempSync(join(tmpdir(), 'argusdev-pi-test-'));
		piSettingsDirOverride = piHome;
	});

	afterEach(() => {
		rmSync(piHome, {recursive: true, force: true});
	});

	it('creates settings.json with our hook path when none exists', () => {
		const settingsPath = join(piHome, '.pi', 'agent', 'settings.json');
		writePiExtensionSettings(hookPath);
		expect(existsSync(settingsPath)).toBe(true);
		const data = JSON.parse(readFileSync(settingsPath, 'utf-8'));
		expect(data.extensions).toContain(hookPath);
	});

	it('appends to existing extensions array without removing others', () => {
		const dir = join(piHome, '.pi', 'agent');
		mkdirSync(dir, {recursive: true});
		const settingsPath = join(dir, 'settings.json');
		writeFileSync(
			settingsPath,
			JSON.stringify({extensions: ['/other/ext.js'], theme: 'dark'}),
		);

		writePiExtensionSettings(hookPath);

		const data = JSON.parse(readFileSync(settingsPath, 'utf-8'));
		expect(data.extensions).toContain('/other/ext.js');
		expect(data.extensions).toContain(hookPath);
		expect(data.theme).toBe('dark');
	});

	it('does not duplicate our entry when called twice', () => {
		writePiExtensionSettings(hookPath);
		writePiExtensionSettings(hookPath);
		const settingsPath = join(piHome, '.pi', 'agent', 'settings.json');
		const data = JSON.parse(readFileSync(settingsPath, 'utf-8'));
		expect(data.extensions.filter((e: string) => e === hookPath)).toHaveLength(
			1,
		);
	});

	it('cleanup removes only our entry and preserves others', () => {
		const dir = join(piHome, '.pi', 'agent');
		mkdirSync(dir, {recursive: true});
		const settingsPath = join(dir, 'settings.json');
		writeFileSync(
			settingsPath,
			JSON.stringify({extensions: ['/other/ext.js']}),
		);

		const cleanup = writePiExtensionSettings(hookPath);
		cleanup();

		const data = JSON.parse(readFileSync(settingsPath, 'utf-8'));
		expect(data.extensions).not.toContain(hookPath);
		expect(data.extensions).toContain('/other/ext.js');
	});

	it('cleanup is a no-op if settings.json is gone', () => {
		const cleanup = writePiExtensionSettings(hookPath);
		rmSync(join(piHome, '.pi', 'agent', 'settings.json'));
		expect(() => cleanup()).not.toThrow();
	});

	it('cleanup leaves file intact when our entry was not present', () => {
		const dir = join(piHome, '.pi', 'agent');
		mkdirSync(dir, {recursive: true});
		const settingsPath = join(dir, 'settings.json');
		writeFileSync(
			settingsPath,
			JSON.stringify({extensions: ['/other/ext.js']}),
		);

		const cleanup = writePiExtensionSettings(hookPath);
		// Manually remove our entry before calling cleanup
		const data = JSON.parse(readFileSync(settingsPath, 'utf-8'));
		data.extensions = data.extensions.filter((e: string) => e !== hookPath);
		writeFileSync(settingsPath, JSON.stringify(data));

		cleanup();

		const final = JSON.parse(readFileSync(settingsPath, 'utf-8'));
		expect(final.extensions).toContain('/other/ext.js');
	});

	it('writes atomically (no .argusdev-tmp leftover)', () => {
		writePiExtensionSettings(hookPath);
		const settingsPath = join(piHome, '.pi', 'agent', 'settings.json');
		expect(existsSync(`${settingsPath}.argusdev-tmp`)).toBe(false);
	});
});

// ── Gemini hook config ────────────────────────────────────────────────────────

describe('buildGeminiHookConfig', () => {
	it('returns valid JSON', () => {
		expect(() =>
			JSON.parse(buildGeminiHookConfig(9999, 'ses-gemini')),
		).not.toThrow();
	});

	it('generates all six hook events', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(9999, 'ses-gemini'));
		expect(cfg.hooks.SessionStart).toHaveLength(1);
		expect(cfg.hooks.BeforeAgent).toHaveLength(1);
		expect(cfg.hooks.BeforeTool).toHaveLength(1);
		expect(cfg.hooks.AfterAgent).toHaveLength(1);
		expect(cfg.hooks.Notification).toHaveLength(1);
		expect(cfg.hooks.SessionEnd).toHaveLength(1);
	});

	it('uses nested wrapper shape with type:command', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(8080, 'ses-x'));
		const entry = cfg.hooks.AfterAgent[0];
		expect(entry.command).toBeUndefined();
		expect(entry.hooks).toHaveLength(1);
		expect(entry.hooks[0].type).toBe('command');
		expect(entry.hooks[0].command).toContain('curl');
	});

	it('maps SessionStart to idle', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(8080, 'ses-x'));
		expect(cfg.hooks.SessionStart[0].hooks[0].command).toContain(
			'/hook-state/idle',
		);
	});

	it('maps BeforeAgent to busy', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(8080, 'ses-x'));
		expect(cfg.hooks.BeforeAgent[0].hooks[0].command).toContain(
			'/hook-state/busy',
		);
	});

	it('maps BeforeTool to busy', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(8080, 'ses-x'));
		expect(cfg.hooks.BeforeTool[0].hooks[0].command).toContain(
			'/hook-state/busy',
		);
	});

	it('maps AfterAgent to idle', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(8080, 'ses-x'));
		expect(cfg.hooks.AfterAgent[0].hooks[0].command).toContain(
			'/hook-state/idle',
		);
	});

	it('maps Notification(ToolPermission) to waiting_input', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(8080, 'ses-x'));
		const entry = cfg.hooks.Notification[0];
		expect(entry.matcher).toBe('ToolPermission');
		expect(entry.hooks[0].command).toContain('/hook-state/waiting_input');
	});

	it('maps SessionEnd to idle', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(8080, 'ses-x'));
		expect(cfg.hooks.SessionEnd[0].hooks[0].command).toContain(
			'/hook-state/idle',
		);
	});

	it('embeds port and session ID in commands', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(54321, 'session-test-xyz'));
		const cmd = cfg.hooks.AfterAgent[0].hooks[0].command;
		expect(cmd).toContain('127.0.0.1:54321');
		expect(cmd).toContain('/sessions/session-test-xyz/');
	});

	it('encodes session IDs with special characters', () => {
		const cfg = JSON.parse(buildGeminiHookConfig(8080, 'session with spaces'));
		const cmd = cfg.hooks.AfterAgent[0].hooks[0].command;
		expect(cmd).toContain('session%20with%20spaces');
	});
});

describe('writeGeminiHookFiles', () => {
	let worktree: string;

	beforeEach(() => {
		worktree = mkdtempSync(join(tmpdir(), 'argusdev-gemini-test-'));
	});

	afterEach(() => {
		rmSync(worktree, {recursive: true, force: true});
	});

	it('writes settings.json in <worktree>/.gemini/', () => {
		writeGeminiHookFiles(worktree, 8080, 'ses-1');
		const settingsPath = join(worktree, '.gemini', 'settings.json');
		expect(existsSync(settingsPath)).toBe(true);
		expect(JSON.parse(readFileSync(settingsPath, 'utf-8')).hooks).toBeDefined();
	});

	it('writes settings.json with mode 0600', () => {
		writeGeminiHookFiles(worktree, 8080, 'ses-mode');
		const mode =
			statSync(join(worktree, '.gemini', 'settings.json')).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it('is idempotent — second call overwrites with new session params', () => {
		writeGeminiHookFiles(worktree, 8080, 'ses-first');
		writeGeminiHookFiles(worktree, 9090, 'ses-second');
		const content = readFileSync(
			join(worktree, '.gemini', 'settings.json'),
			'utf-8',
		);
		expect(content).toContain(':9090');
		expect(content).toContain('ses-second');
	});

	it('cleanup fn removes settings.json when none pre-existed', () => {
		const cleanup = writeGeminiHookFiles(worktree, 8080, 'ses-clean');
		const settingsPath = join(worktree, '.gemini', 'settings.json');
		expect(existsSync(settingsPath)).toBe(true);
		cleanup();
		expect(existsSync(settingsPath)).toBe(false);
	});

	it('cleanup fn restores pre-existing settings.json', () => {
		const geminiDir = join(worktree, '.gemini');
		mkdirSync(geminiDir, {recursive: true});
		const originalSettings = JSON.stringify({theme: 'dark', someKey: 'value'});
		writeFileSync(join(geminiDir, 'settings.json'), originalSettings, {
			encoding: 'utf-8',
		});

		const cleanup = writeGeminiHookFiles(worktree, 8080, 'ses-restore');
		const active = readFileSync(join(geminiDir, 'settings.json'), 'utf-8');
		expect(JSON.parse(active).hooks).toBeDefined();

		cleanup();
		const restored = readFileSync(join(geminiDir, 'settings.json'), 'utf-8');
		expect(restored).toBe(originalSettings);
		expect(
			existsSync(join(geminiDir, 'settings.json.argusdev-backup')),
		).toBe(false);
	});

	it('cleanup is a no-op when settings.json already removed', () => {
		const cleanup = writeGeminiHookFiles(worktree, 8080, 'ses-gone');
		unlinkSync(join(worktree, '.gemini', 'settings.json'));
		expect(() => cleanup()).not.toThrow();
	});

	it('writes atomically (no .tmp leftover)', () => {
		writeGeminiHookFiles(worktree, 8080, 'ses-atomic');
		const settingsPath = join(worktree, '.gemini', 'settings.json');
		expect(existsSync(`${settingsPath}.tmp`)).toBe(false);
	});
});
