import {existsSync, readdirSync, readFileSync, statSync} from 'fs';
import {homedir} from 'os';
import path from 'path';
import type {ConversationMessage} from './types.js';

export function safeReadJsonLines(filePath: string): unknown[] {
	try {
		const content = readFileSync(filePath, 'utf8');
		return content
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.map(line => {
				try {
					return JSON.parse(line);
				} catch {
					return null;
				}
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

export function safeReadLines(filePath: string): string[] {
	try {
		return readFileSync(filePath, 'utf8')
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export function safeReadJsonFile(filePath: string): unknown {
	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch {
		return null;
	}
}

export function normalizeTimestamp(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		if (value > 10_000_000_000) {
			return Math.floor(value / 1000);
		}
		return Math.floor(value);
	}
	if (typeof value === 'string') {
		const numeric = Number.parseFloat(value);
		if (Number.isFinite(numeric)) {
			if (numeric > 10_000_000_000) {
				return Math.floor(numeric / 1000);
			}
			return Math.floor(numeric);
		}
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) {
			return Math.floor(parsed / 1000);
		}
	}
	return null;
}

export function extractString(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}

	if (Array.isArray(value)) {
		return value
			.map(part => extractString(part))
			.filter(Boolean)
			.join('\n')
			.trim();
	}

	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const keys = [
			'text',
			'content',
			'message',
			'input',
			'output',
			'body',
			'value',
		];
		for (const key of keys) {
			if (key in record) {
				const nested = extractString(record[key]);
				if (nested) return nested;
			}
		}

		return JSON.stringify(record);
	}

	if (value === undefined || value === null) {
		return '';
	}

	return String(value);
}

export function buildPreview(content: string, maxLength = 300): string {
	const normalized = content.replace(/\s+/g, ' ').trim();
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, maxLength)}...`;
}

export function sortedFilesByMtime(
	directory: string,
	matcher: (fileName: string) => boolean,
): string[] {
	if (!existsSync(directory)) {
		return [];
	}

	const files = readdirSync(directory)
		.filter(fileName => matcher(fileName))
		.map(fileName => ({
			filePath: path.join(directory, fileName),
			mtimeMs: safeMtimeMs(path.join(directory, fileName)),
		}))
		.filter(item => item.mtimeMs > 0)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.map(item => item.filePath);

	return files;
}

export function recursiveFindFiles(
	root: string,
	matcher: (fileName: string) => boolean,
	maxResults = 200,
): string[] {
	const results: Array<{path: string; mtimeMs: number}> = [];

	function walk(current: string): void {
		if (results.length >= maxResults * 2) {
			return;
		}

		let entries: string[];
		try {
			entries = readdirSync(current);
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(current, entry);
			if (isDirectory(fullPath)) {
				walk(fullPath);
				continue;
			}

			if (!matcher(entry)) {
				continue;
			}

			const mtimeMs = safeMtimeMs(fullPath);
			if (mtimeMs <= 0) {
				continue;
			}
			results.push({path: fullPath, mtimeMs});
		}
	}

	if (existsSync(root)) {
		walk(root);
	}

	return results
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.slice(0, maxResults)
		.map(item => item.path);
}

export function homePath(...parts: string[]): string {
	return path.join(homedir(), ...parts);
}

export function withinRecentWindow(
	filePath: string,
	afterTimestamp?: Date,
	marginMs = 120000,
): boolean {
	if (!afterTimestamp) {
		return true;
	}
	const mtime = safeMtimeMs(filePath);
	if (mtime <= 0) return false;
	return mtime + marginMs >= afterTimestamp.getTime();
}

export function normalizeRole(role: unknown): ConversationMessage['role'] {
	if (typeof role !== 'string') return 'system';
	const normalized = role.toLowerCase();
	if (normalized === 'assistant') return 'assistant';
	if (normalized === 'user') return 'user';
	if (normalized === 'tool') return 'tool';
	return 'system';
}

function safeMtimeMs(filePath: string): number {
	try {
		const stats = statSync(filePath);
		return stats.isFile() ? stats.mtimeMs : -1;
	} catch {
		return -1;
	}
}

function isDirectory(candidatePath: string): boolean {
	try {
		return statSync(candidatePath).isDirectory();
	} catch {
		return false;
	}
}
