import {
	writeFileSync,
	unlinkSync,
	mkdirSync,
	readdirSync,
	renameSync,
	chmodSync,
	readFileSync,
	existsSync,
} from 'fs';
import {join} from 'path';
import {getConfigDir} from './configDir.js';

/**
 * Build Claude Code settings object with HTTP hooks for state detection.
 *
 * Instead of polling the terminal buffer, Claude Code's own lifecycle hooks
 * POST state transitions directly to ArgusDev's internal API.
 *
 * Uses Claude Code's native `http` hook type — no curl dependency needed.
 * See: https://code.claude.com/docs/en/hooks
 *
 * Hook → State mapping:
 *   UserPromptSubmit                → busy  (user sent a message)
 *   PreToolUse                      → busy  (tool execution starting)
 *   Notification(permission_prompt) → waiting_input
 *   Notification(idle_prompt)       → idle
 *   Stop                            → idle  (response complete)
 */
export function buildClaudeHookSettings(
	port: number,
	sessionId: string,
): string {
	const base = `http://127.0.0.1:${port}/api/internal/sessions/${encodeURIComponent(sessionId)}/hook-state`;

	const hook = (state: string) => ({
		type: 'http' as const,
		url: `${base}/${state}`,
	});

	const settings = {
		hooks: {
			UserPromptSubmit: [
				{
					hooks: [hook('busy')],
				},
			],
			PreToolUse: [
				{
					hooks: [hook('busy')],
				},
			],
			Notification: [
				{
					matcher: 'permission_prompt',
					hooks: [hook('waiting_input')],
				},
				{
					matcher: 'idle_prompt',
					hooks: [hook('idle')],
				},
			],
			Stop: [
				{
					hooks: [hook('idle')],
				},
			],
		},
	};

	return JSON.stringify(settings);
}

/**
 * Write hook settings atomically and return the path. Pass to
 * `claude --settings <path>`.
 *
 * Stored under <configDir>/hooks/<sessionId>.json so the file survives
 * macOS periodic temp cleanup for sessions running for days.
 */
export function writeHookSettingsFile(port: number, sessionId: string): string {
	const filePath = hookSettingsPath(sessionId);
	const tmpPath = `${filePath}.tmp`;
	writeFileSync(tmpPath, buildClaudeHookSettings(port, sessionId), {
		encoding: 'utf-8',
		mode: 0o600,
	});
	renameSync(tmpPath, filePath);
	return filePath;
}

/**
 * Clean up the hook settings file for a session. Tolerates missing files.
 */
export function cleanupHookSettingsFile(sessionId: string): void {
	try {
		unlinkSync(hookSettingsPath(sessionId));
	} catch {
		// File already gone — fine
	}
}

/**
 * Remove orphan hook files for sessions that no longer exist.
 *
 * MUST run after persisted sessions have been rehydrated, otherwise live
 * sessions will be considered orphans.
 *
 * Returns the number of files removed.
 */
export function sweepOrphanHookSettings(activeSessionIds: Set<string>): number {
	let removed = 0;
	let entries: string[];
	try {
		entries = readdirSync(hooksDir());
	} catch {
		return 0;
	}
	for (const entry of entries) {
		if (!entry.endsWith('.json')) continue;
		const id = entry.slice(0, -'.json'.length);
		if (activeSessionIds.has(id)) continue;
		try {
			unlinkSync(join(hooksDir(), entry));
			removed += 1;
		} catch {
			// Ignore — best-effort cleanup
		}
	}
	return removed;
}

function hooksDir(): string {
	const dir = join(getConfigDir(), 'hooks');
	mkdirSync(dir, {recursive: true});
	try {
		chmodSync(dir, 0o700);
	} catch {
		// Best-effort — non-POSIX filesystems may reject
	}
	return dir;
}

function hookSettingsPath(sessionId: string): string {
	return join(hooksDir(), `${sessionId}.json`);
}

/**
 * Build Codex hooks.json content wiring lifecycle events to ArgusDev's
 * internal hook-state endpoint via curl.
 *
 * Codex only supports `command` hook type (no native http type).
 *
 * Hook → State mapping:
 *   SessionStart     → ack only (no state change, but confirms hooks are wired)
 *   UserPromptSubmit → busy
 *   PreToolUse       → busy  (Bash tool only — re-asserts busy during tool use)
 *   PermissionRequest → waiting_input
 *   Stop             → idle
 */
export function buildCodexHookConfig(port: number, sessionId: string): string {
	const base = `http://127.0.0.1:${port}/api/internal/sessions/${encodeURIComponent(sessionId)}/hook-state`;

	const curlCmd = (state: string) =>
		`curl -s -X POST ${base}/${state} > /dev/null 2>&1 || true`;

	const config = {
		hooks: {
			SessionStart: [{command: curlCmd('idle')}],
			UserPromptSubmit: [{command: curlCmd('busy')}],
			PreToolUse: [{command: curlCmd('busy')}],
			PermissionRequest: [{command: curlCmd('waiting_input')}],
			Stop: [{command: curlCmd('idle')}],
		},
	};

	return JSON.stringify(config, null, 2);
}

/**
 * Write .codex/hooks.json and patch .codex/config.toml (codex_hooks = true)
 * in the given worktree. Idempotent — safe to call on session recovery.
 */
export function writeCodexHookFiles(
	worktreePath: string,
	port: number,
	sessionId: string,
): void {
	const codexDir = join(worktreePath, '.codex');
	mkdirSync(codexDir, {recursive: true});

	const hooksPath = join(codexDir, 'hooks.json');
	const tmpPath = `${hooksPath}.tmp`;
	writeFileSync(tmpPath, buildCodexHookConfig(port, sessionId), {
		encoding: 'utf-8',
		mode: 0o600,
	});
	renameSync(tmpPath, hooksPath);

	patchCodexConfigToml(codexDir);
}

/**
 * Remove the generated hooks.json from .codex/ in the worktree.
 * Does not revert config.toml — codex_hooks = true is harmless when no
 * hooks.json is present and the worktree may persist across sessions.
 */
export function cleanupCodexHookFiles(worktreePath: string): void {
	try {
		unlinkSync(join(worktreePath, '.codex', 'hooks.json'));
	} catch {
		// File already gone — fine
	}
}

function patchCodexConfigToml(codexDir: string): void {
	const configPath = join(codexDir, 'config.toml');
	let content = '';
	if (existsSync(configPath)) {
		content = readFileSync(configPath, 'utf-8');
	}

	if (/^\s*codex_hooks\s*=/m.test(content)) {
		// Already present — ensure it's true
		content = content.replace(/^(\s*codex_hooks\s*=\s*).+$/m, '$1true');
	} else if (/^\s*\[features\]/m.test(content)) {
		// [features] section exists — append under it
		content = content.replace(/^(\s*\[features\])/m, '$1\ncodex_hooks = true');
	} else {
		// No [features] section — append one
		const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
		content = `${content}${separator}\n[features]\ncodex_hooks = true\n`;
	}

	writeFileSync(configPath, content, {encoding: 'utf-8'});
}
