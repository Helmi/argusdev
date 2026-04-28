/* global fetch */
/**
 * ArgusDev Pi extension — reports busy/idle state via HTTP.
 *
 * Loaded by Pi's extension system (jiti). Reads ARGUSDEV_SESSION_ID and
 * ARGUSDEV_PORT from the environment set at Pi spawn time.
 *
 * waiting_input is NOT reported here — Pi's PTY regex fallback handles it.
 */
export default function (pi: {
	on(event: string, handler: (...args: unknown[]) => unknown): void;
}) {
	const sessionId = process.env['ARGUSDEV_SESSION_ID'];
	const port = process.env['ARGUSDEV_PORT'];
	if (!sessionId || !port) return;

	const base = `http://127.0.0.1:${port}/api/internal/sessions/${encodeURIComponent(sessionId)}/hook-state`;
	const post = (state: string) =>
		fetch(`${base}/${state}`, {method: 'POST'}).catch(() => {});

	pi.on('tool_call', () => {
		void post('busy');
	});

	pi.on('agent_end', () => {
		void post('idle');
	});

	pi.on('session_shutdown', () => {
		void post('idle');
	});
}
