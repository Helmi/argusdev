import {EventEmitter} from 'events';
import type {SdkEvent} from '../types/index.js';
import {logger} from '../utils/logger.js';

/**
 * Line-buffered NDJSON parser for Claude CLI --output-format stream-json.
 * Accumulates partial lines from stdout chunks and emits typed SdkEvent
 * objects as each complete JSON line arrives.
 */
export class SdkEventParser extends EventEmitter {
	private buffer = '';

	/** Feed a raw stdout chunk. May contain partial lines, complete lines, or multiple lines. */
	write(chunk: string): void {
		this.buffer += chunk;

		let newlineIdx: number;
		while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
			const line = this.buffer.slice(0, newlineIdx).trim();
			this.buffer = this.buffer.slice(newlineIdx + 1);
			if (line.length === 0) continue;
			this.parseLine(line);
		}
	}

	/** Flush any remaining buffer content (e.g., on process exit). */
	flush(): void {
		const remaining = this.buffer.trim();
		this.buffer = '';
		if (remaining.length > 0) {
			this.parseLine(remaining);
		}
	}

	private parseLine(line: string): void {
		try {
			const event = JSON.parse(line) as SdkEvent;
			if (!event.type) {
				logger.warn(`[SdkEventParser] JSON line missing type field: ${line.slice(0, 100)}`);
				return;
			}
			this.emit('event', event);
		} catch {
			// Non-JSON output (e.g., stderr leaking to stdout, or startup messages)
			logger.warn(`[SdkEventParser] Non-JSON line: ${line.slice(0, 200)}`);
			this.emit('raw', line);
		}
	}
}
