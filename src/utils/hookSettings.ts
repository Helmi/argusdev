/**
 * Build Claude Code --settings JSON that injects HTTP hooks for state detection.
 *
 * Instead of polling the terminal buffer, Claude Code's own lifecycle hooks
 * POST state transitions directly to ArgusDev's internal API.
 *
 * Hook → State mapping:
 *   Notification(permission_prompt) → waiting_input
 *   Notification(idle_prompt)       → idle
 *   Stop                            → idle
 *   PreToolUse                      → busy
 */
export function buildClaudeHookSettings(
	port: number,
	sessionId: string,
): string {
	const base = `http://127.0.0.1:${port}/api/internal/sessions/${encodeURIComponent(sessionId)}/hook-state`;

	const settings = {
		hooks: {
			Notification: [
				{
					matcher: 'permission_prompt',
					hooks: [{type: 'http', url: `${base}/waiting_input`}],
				},
				{
					matcher: 'idle_prompt',
					hooks: [{type: 'http', url: `${base}/idle`}],
				},
			],
			Stop: [
				{
					hooks: [{type: 'http', url: `${base}/idle`}],
				},
			],
			PreToolUse: [
				{
					hooks: [{type: 'http', url: `${base}/busy`}],
				},
			],
		},
	};

	return JSON.stringify(settings);
}
