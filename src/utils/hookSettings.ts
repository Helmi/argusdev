import {
	writeFileSync,
	unlinkSync,
	mkdirSync,
	rmdirSync,
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
 * Uses the nested wrapper shape Codex requires:
 *   EventName: [{ hooks: [{ type: "command", command: "..." }] }]
 * PreToolUse is scoped to Bash only via matcher to avoid spurious busy signals.
 *
 * Hook → State mapping:
 *   SessionStart     → idle  (confirms hooks are wired on session start)
 *   UserPromptSubmit → busy
 *   PreToolUse       → busy  (Bash tool only)
 *   PermissionRequest → waiting_input
 *   Stop             → idle
 */
export function buildCodexHookConfig(port: number, sessionId: string): string {
	const base = `http://127.0.0.1:${port}/api/internal/sessions/${encodeURIComponent(sessionId)}/hook-state`;

	const hook = (state: string) => ({
		type: 'command' as const,
		command: `curl -s -X POST ${base}/${state} > /dev/null 2>&1 || true`,
	});

	const config = {
		hooks: {
			SessionStart: [{hooks: [hook('idle')]}],
			UserPromptSubmit: [{hooks: [hook('busy')]}],
			PreToolUse: [{matcher: 'Bash', hooks: [hook('busy')]}],
			PermissionRequest: [{hooks: [hook('waiting_input')]}],
			Stop: [{hooks: [hook('idle')]}],
		},
	};

	return JSON.stringify(config, null, 2);
}

const ARGUSDEV_BACKUP_SUFFIX = '.argusdev-backup';

/**
 * Write .codex/hooks.json and patch .codex/config.toml (codex_hooks = true)
 * in the given worktree.
 *
 * If a hooks.json already exists that ArgusDev did not create, it is
 * snapshotted to hooks.json.argusdev-backup before being overwritten.
 * Similarly, if config.toml does not exist we record that so cleanup can
 * remove the file we created.
 *
 * Returns a cleanup function that restores the pre-session state.
 */
export function writeCodexHookFiles(
	worktreePath: string,
	port: number,
	sessionId: string,
): () => void {
	const codexDir = join(worktreePath, '.codex');
	mkdirSync(codexDir, {recursive: true});

	// --- hooks.json ---
	const hooksPath = join(codexDir, 'hooks.json');
	const hooksBackupPath = `${hooksPath}${ARGUSDEV_BACKUP_SUFFIX}`;
	const hadExistingHooks = existsSync(hooksPath);
	if (hadExistingHooks) {
		// Snapshot before overwriting so cleanup can restore it
		writeFileSync(hooksBackupPath, readFileSync(hooksPath), {mode: 0o600});
	}
	const tmpPath = `${hooksPath}.tmp`;
	writeFileSync(tmpPath, buildCodexHookConfig(port, sessionId), {
		encoding: 'utf-8',
		mode: 0o600,
	});
	renameSync(tmpPath, hooksPath);

	// --- config.toml ---
	const configPath = join(codexDir, 'config.toml');
	const hadExistingConfig = existsSync(configPath);
	const originalConfig = hadExistingConfig
		? readFileSync(configPath, 'utf-8')
		: null;
	patchCodexConfigToml(codexDir);

	return () => {
		// Restore hooks.json
		if (hadExistingHooks && existsSync(hooksBackupPath)) {
			writeFileSync(hooksPath, readFileSync(hooksBackupPath), {mode: 0o600});
			try {
				unlinkSync(hooksBackupPath);
			} catch {
				// best-effort
			}
		} else {
			try {
				unlinkSync(hooksPath);
			} catch {
				// File already gone — fine
			}
		}
		// Restore config.toml
		if (originalConfig !== null) {
			writeFileSync(configPath, originalConfig, {encoding: 'utf-8'});
		} else if (!hadExistingConfig) {
			try {
				unlinkSync(configPath);
			} catch {
				// File already gone — fine
			}
		}
	};
}

/**
 * Remove the generated hooks.json from .codex/ in the worktree.
 * Kept for callers that don't use the cleanup fn returned by writeCodexHookFiles.
 */
export function cleanupCodexHookFiles(worktreePath: string): void {
	try {
		unlinkSync(join(worktreePath, '.codex', 'hooks.json'));
	} catch {
		// File already gone — fine
	}
}

const OPENCODE_PLUGIN_FILENAME = 'argusdev-state.js';

/**
 * Generate the ArgusDev state-detection plugin for OpenCode.
 *
 * Port and sessionId are baked into the file so no extra env vars or CLI args
 * are needed. The plugin:
 *   - tool.execute.before           → POST busy
 *   - permission.ask                → POST waiting_input
 *   - event(session.idle)           → POST idle
 *   - event(session.status, idle)   → POST idle
 *   - event(session.status, busy)   → POST busy  (pure-chat responses with no tool calls)
 */
export function buildOpencodePluginContent(
	port: number,
	sessionId: string,
): string {
	const base = `http://127.0.0.1:${port}/api/internal/sessions/${encodeURIComponent(sessionId)}/hook-state`;

	return `// ArgusDev state-detection plugin — auto-generated, do not edit
export const server = async () => ({
  "tool.execute.before": async (_input, output) => {
    fetch("${base}/busy", { method: "POST" }).catch(() => {});
  },
  "permission.ask": async (_input, output) => {
    fetch("${base}/waiting_input", { method: "POST" }).catch(() => {});
    return output;
  },
  event: async ({ event }) => {
    if (
      event.type === "session.idle" ||
      (event.type === "session.status" && event.properties?.status?.type === "idle")
    ) {
      fetch("${base}/idle", { method: "POST" }).catch(() => {});
    } else if (
      event.type === "session.status" &&
      event.properties?.status?.type === "busy"
    ) {
      fetch("${base}/busy", { method: "POST" }).catch(() => {});
    }
  },
});
`;
}

/**
 * Write the ArgusDev plugin to <worktreePath>/.opencode/plugins/ and return
 * a cleanup function that removes the file (and the directory if ArgusDev
 * created it).
 *
 * Surgical: the plugin filename (argusdev-state.js) is unique to ArgusDev so
 * no user file is ever overwritten. No opencode.json patching needed — OpenCode
 * auto-loads all .js/.ts files from .opencode/plugins/.
 */
export function writeOpencodePluginFile(
	worktreePath: string,
	port: number,
	sessionId: string,
): () => void {
	const pluginsDir = join(worktreePath, '.opencode', 'plugins');
	const pluginPath = join(pluginsDir, OPENCODE_PLUGIN_FILENAME);
	const dirExisted = existsSync(pluginsDir);

	mkdirSync(pluginsDir, {recursive: true});

	const tmpPath = `${pluginPath}.tmp`;
	writeFileSync(tmpPath, buildOpencodePluginContent(port, sessionId), {
		encoding: 'utf-8',
		mode: 0o600,
	});
	renameSync(tmpPath, pluginPath);

	return () => {
		try {
			unlinkSync(pluginPath);
		} catch {
			// File already gone — fine
		}
		if (!dirExisted) {
			// Only remove the directory if ArgusDev created it and it is now empty
			try {
				const remaining = readdirSync(pluginsDir);
				if (remaining.length === 0) {
					rmdirSync(pluginsDir);
				}
			} catch {
				// Best-effort
			}
		}
	};
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
