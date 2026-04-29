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
import {fileURLToPath} from 'url';
import {getConfigDir} from './configDir.js';
import {homePath} from '../adapters/helpers.js';
import {logger} from './logger.js';

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
const ARGUSDEV_HOOK_MARKER = '/api/internal/sessions/';

// Returns true when a raw config file string contains ArgusDev hook URLs.
// Used to detect "we created/owned this file" vs "user owns it" when deciding
// whether to trust an existing backup or refresh it.
// Constraint: raw-string match is coarser than full JSON parse, but false
// positives (user config accidentally containing this URL fragment) are
// vanishingly unlikely, and the consequence is only "refresh backup" not
// data loss.
function isArgusdevOwnedContent(raw: string): boolean {
	return raw.includes(ARGUSDEV_HOOK_MARKER);
}

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
		const backupExists = existsSync(hooksBackupPath);
		const currentRaw = readFileSync(hooksPath);
		const currentIsOurs = isArgusdevOwnedContent(currentRaw.toString('utf-8'));
		if (!backupExists || !currentIsOurs) {
			// Refresh backup when:
			// - No backup yet (first session start): snapshot user's file.
			// - Backup exists but current file is NOT ours: user re-edited
			//   hooks.json after a crash; treat their edits as the new pristine.
			// Skip when backup exists AND current file is ours (crash-recovery):
			// the existing backup already holds the real pre-session original.
			writeFileSync(hooksBackupPath, currentRaw, {mode: 0o600});
		}
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
	// Capture what we wrote so cleanup can verify the file hasn't been edited
	// by the user or codex during the session before deciding to restore.
	const patchedConfig = readFileSync(configPath, 'utf-8');

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
		// Restore config.toml — but only if the file hasn't been modified
		// since we wrote it.  If the user or codex edited it during the
		// session, leave it alone to avoid silently discarding their changes.
		if (originalConfig !== null) {
			const currentConfig = existsSync(configPath)
				? readFileSync(configPath, 'utf-8')
				: null;
			if (currentConfig === patchedConfig) {
				writeFileSync(configPath, originalConfig, {encoding: 'utf-8'});
			} else {
				logger.warn(
					`config.toml was modified during session; skipping revert to preserve user edits`,
				);
			}
		} else if (!hadExistingConfig) {
			const currentConfig = existsSync(configPath)
				? readFileSync(configPath, 'utf-8')
				: null;
			if (currentConfig === null || currentConfig === patchedConfig) {
				try {
					unlinkSync(configPath);
				} catch {
					// File already gone — fine
				}
			} else {
				logger.warn(
					`config.toml created by ArgusDev was modified during session; skipping unlink to preserve user edits`,
				);
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
 *   - event(question.asked)         → POST waiting_input  (agent question tool)
 *   - event(question.replied)       → POST busy
 *   - event(question.rejected)      → POST busy
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
    } else if (event.type === "question.asked") {
      fetch("${base}/waiting_input", { method: "POST" }).catch(() => {});
    } else if (
      event.type === "question.replied" ||
      event.type === "question.rejected"
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

/**
 * Resolve the compiled piHook.js path for the current installation.
 * src/hooks/piHook.ts compiles to dist/hooks/piHook.js; this file
 * compiles to dist/utils/hookSettings.js, so the hook is one level up.
 */
function piHookPath(): string {
	const thisFile = fileURLToPath(import.meta.url);
	const jsCandidate = join(thisFile, '..', '..', 'hooks', 'piHook.js');
	if (existsSync(jsCandidate)) return jsCandidate;
	// Dev mode: running from src/ via tsx — jiti can load .ts directly
	return join(thisFile, '..', '..', 'hooks', 'piHook.ts');
}

const PI_SETTINGS_PATH = () => homePath('.pi', 'agent', 'settings.json');

/**
 * Patch ~/.pi/agent/settings.json to include the ArgusDev Pi extension.
 * Appends our hook path to the existing extensions array surgically —
 * does not snapshot/restore the whole file, to avoid clobbering concurrent changes.
 *
 * Returns a cleanup function that removes only our entry.
 */
export function writePiExtensionSettings(hookPath: string): () => void {
	const settingsPath = PI_SETTINGS_PATH();
	const dir = join(settingsPath, '..');
	mkdirSync(dir, {recursive: true});

	let existing: Record<string, unknown> = {};
	if (existsSync(settingsPath)) {
		try {
			existing = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<
				string,
				unknown
			>;
		} catch {
			// Malformed settings — start fresh
		}
	}

	const extensions: string[] = Array.isArray(existing['extensions'])
		? (existing['extensions'] as string[])
		: [];

	if (!extensions.includes(hookPath)) {
		extensions.push(hookPath);
	}

	const patched = {...existing, extensions};
	const tmpPath = `${settingsPath}.argusdev-tmp`;
	writeFileSync(tmpPath, JSON.stringify(patched, null, 2), {
		encoding: 'utf-8',
		mode: 0o600,
	});
	renameSync(tmpPath, settingsPath);

	return () => {
		try {
			const raw = readFileSync(settingsPath, 'utf-8');
			const current = JSON.parse(raw) as Record<string, unknown>;
			const currentExtensions: string[] = Array.isArray(current['extensions'])
				? (current['extensions'] as string[])
				: [];
			const filtered = currentExtensions.filter(e => e !== hookPath);
			const restored = {...current, extensions: filtered};
			const tmpCleanup = `${settingsPath}.argusdev-tmp`;
			writeFileSync(tmpCleanup, JSON.stringify(restored, null, 2), {
				encoding: 'utf-8',
				mode: 0o600,
			});
			renameSync(tmpCleanup, settingsPath);
		} catch {
			// Best-effort — if settings.json is gone or unreadable, skip
		}
	};
}

/**
 * Resolve the absolute path to the compiled piHook.js and call
 * writePiExtensionSettings. Returns the cleanup fn.
 */
export function writePiHookFiles(): () => void {
	return writePiExtensionSettings(piHookPath());
}

/**
 * Build Gemini CLI settings.json content wiring lifecycle events to ArgusDev's
 * internal hook-state endpoint via curl.
 *
 * Uses the same nested wrapper shape as Codex:
 *   EventName: [{ hooks: [{ type: "command", command: "..." }] }]
 * Notification is scoped to ToolPermission via matcher to avoid false positives.
 * Interactive shell stdin waiting is NOT covered (upstream issue #19527, unshipped).
 *
 * Hook → State mapping:
 *   SessionStart  → idle  (confirms hooks are wired on session start / resume)
 *   BeforeAgent   → busy  (after user submission, before planning)
 *   BeforeTool    → busy  (before tool invocation)
 *   AfterAgent    → idle  (after model generates response)
 *   Notification  → waiting_input (ToolPermission events only)
 *   SessionEnd    → idle  (cleanup signal on exit)
 */
export function buildGeminiHookConfig(port: number, sessionId: string): string {
	const base = `http://127.0.0.1:${port}/api/internal/sessions/${encodeURIComponent(sessionId)}/hook-state`;

	const hook = (state: string) => ({
		type: 'command' as const,
		command: `curl -s -X POST ${base}/${state} > /dev/null 2>&1 || true`,
	});

	const config = {
		hooks: {
			SessionStart: [{hooks: [hook('idle')]}],
			BeforeAgent: [{hooks: [hook('busy')]}],
			BeforeTool: [{hooks: [hook('busy')]}],
			AfterAgent: [{hooks: [hook('idle')]}],
			Notification: [
				{matcher: 'ToolPermission', hooks: [hook('waiting_input')]},
			],
			SessionEnd: [{hooks: [hook('idle')]}],
		},
	};

	return JSON.stringify(config, null, 2);
}

function isArgusdevHookEntry(entry: unknown): boolean {
	if (!entry || typeof entry !== 'object') return false;
	const hooks = (entry as {hooks?: unknown}).hooks;
	if (!Array.isArray(hooks)) return false;
	return hooks.some(
		h =>
			h &&
			typeof h === 'object' &&
			typeof (h as {command?: unknown}).command === 'string' &&
			(h as {command: string}).command.includes(ARGUSDEV_HOOK_MARKER),
	);
}

/**
 * Write .gemini/settings.json in the given worktree, merging ArgusDev hooks
 * into any pre-existing user config (mcpServers, theme, custom hooks, etc.).
 *
 * Merge strategy: stale ArgusDev hook entries (identified by URL marker) are
 * stripped first, then new ones appended. User-owned hooks for the same event
 * continue to fire. Pre-existing keys outside `hooks` are preserved verbatim.
 *
 * Backup is written only when no backup already exists — crash-recovery
 * re-runs therefore preserve the pristine pre-session original, not a
 * session-polluted intermediate. Cleanup restores verbatim from backup.
 */
export function writeGeminiHookFiles(
	worktreePath: string,
	port: number,
	sessionId: string,
): () => void {
	const geminiDir = join(worktreePath, '.gemini');
	mkdirSync(geminiDir, {recursive: true});

	const settingsPath = join(geminiDir, 'settings.json');
	const backupPath = `${settingsPath}${ARGUSDEV_BACKUP_SUFFIX}`;
	const hadExisting = existsSync(settingsPath);

	let existing: Record<string, unknown> = {};
	// stripOnCleanup: no pristine backup to restore from — cleanup must strip
	// our hooks from whatever is on disk rather than restoring or unlinking blindly.
	// true when: (a) fresh worktree with no prior settings.json, or (b) the
	// existing file was ArgusDev-owned with no backup (post-crash re-enter).
	// false when: a backup was snapshotted (either now or in a prior session).
	let stripOnCleanup = !hadExisting;
	if (hadExisting) {
		const raw = readFileSync(settingsPath);
		const rawStr = raw.toString('utf-8');
		const backupExists = existsSync(backupPath);

		if (backupExists) {
			// Existing backup is canonical — crash-recovery must not overwrite it
			// with a session-polluted intermediate.
		} else if (isArgusdevOwnedContent(rawStr)) {
			// No backup AND current file is ArgusDev-owned: prior crashed session
			// created this file. Skip snapshotting — there is no pristine to save.
			// Cleanup will strip our hooks (unlink only if nothing user-owned remains).
			stripOnCleanup = true;
		} else {
			// No backup, current file is user's — snapshot it as pristine.
			writeFileSync(backupPath, raw, {mode: 0o600});
		}

		try {
			existing = JSON.parse(rawStr) as Record<string, unknown>;
		} catch {
			// Malformed settings — treat as empty, backup still restores it
		}
	}

	const argusdevHooks = (
		JSON.parse(buildGeminiHookConfig(port, sessionId)) as {
			hooks: Record<string, unknown[]>;
		}
	).hooks;
	const existingHooks =
		existing['hooks'] && typeof existing['hooks'] === 'object'
			? (existing['hooks'] as Record<string, unknown>)
			: {};

	const mergedHooks: Record<string, unknown> = {...existingHooks};
	for (const [event, entries] of Object.entries(argusdevHooks)) {
		const priorRaw = Array.isArray(mergedHooks[event])
			? (mergedHooks[event] as unknown[])
			: [];
		const priorFiltered = priorRaw.filter(e => !isArgusdevHookEntry(e));
		mergedHooks[event] = [...priorFiltered, ...(entries as unknown[])];
	}

	const merged = {...existing, hooks: mergedHooks};
	const tmpPath = `${settingsPath}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(merged, null, 2), {
		encoding: 'utf-8',
		mode: 0o600,
	});
	renameSync(tmpPath, settingsPath);

	return () => {
		if (!stripOnCleanup && existsSync(backupPath)) {
			// Pristine backup exists — restore it verbatim.
			writeFileSync(settingsPath, readFileSync(backupPath), {mode: 0o600});
			try {
				unlinkSync(backupPath);
			} catch {
				// best-effort
			}
		} else if (stripOnCleanup) {
			// No pristine to restore. Strip our hooks from whatever is on disk.
			// If nothing user-owned remains, unlink. Otherwise write back the
			// stripped content so user's mcpServers/theme/etc. are preserved.
			try {
				const current = existsSync(settingsPath)
					? (JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<
							string,
							unknown
						>)
					: null;
				if (current === null) return;

				const currentHooks =
					current['hooks'] && typeof current['hooks'] === 'object'
						? (current['hooks'] as Record<string, unknown>)
						: {};

				const strippedHooks: Record<string, unknown> = {};
				for (const [event, entries] of Object.entries(currentHooks)) {
					const kept = Array.isArray(entries)
						? entries.filter(e => !isArgusdevHookEntry(e))
						: [];
					if (kept.length > 0) strippedHooks[event] = kept;
				}

				const stripped: Record<string, unknown> = {...current};
				if (Object.keys(strippedHooks).length === 0) {
					delete stripped['hooks'];
				} else {
					stripped['hooks'] = strippedHooks;
				}

				if (Object.keys(stripped).length === 0) {
					unlinkSync(settingsPath);
				} else {
					writeFileSync(settingsPath, JSON.stringify(stripped, null, 2), {
						encoding: 'utf-8',
						mode: 0o600,
					});
				}
			} catch {
				// best-effort — file may already be gone
			}
		} else {
			try {
				unlinkSync(settingsPath);
			} catch {
				// File already gone — fine
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
