import {writeFileSync, unlinkSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

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
 * Write hook settings to a temp file and return the path.
 * Pass this path to `claude --settings <path>` instead of inline JSON
 * to avoid polluting the terminal with a huge command line.
 */
export function writeHookSettingsFile(port: number, sessionId: string): string {
	const json = buildClaudeHookSettings(port, sessionId);
	const filePath = hookSettingsPath(sessionId);
	writeFileSync(filePath, json, 'utf-8');
	return filePath;
}

/**
 * Clean up the hook settings temp file for a session.
 */
export function cleanupHookSettingsFile(sessionId: string): void {
	try {
		unlinkSync(hookSettingsPath(sessionId));
	} catch {
		// File already gone — fine
	}
}

function hookSettingsPath(sessionId: string): string {
	return join(tmpdir(), `argusdev-hooks-${sessionId}.json`);
}
