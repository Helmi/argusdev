/* global fetch */
import {createRequire} from 'node:module';
import type {configurationManager as ConfigManagerType} from './configurationManager.js';
import {
	GITHUB_RELEASES_API,
	UPDATE_CHECK_TTL_MS,
	type UpdateCheckCacheEntry,
} from '../constants/env.js';
import {logger} from '../utils/logger.js';

interface GitHubRelease {
	tag_name?: string;
}

export type UpdateCheckSource = 'cache' | 'network';

export interface UpdateCheckResult {
	currentVersion: string;
	latestVersion?: string;
	latestTag?: string;
	checkedAt: number;
	isUpdateAvailable: boolean;
	isStale: boolean;
	source: UpdateCheckSource;
	error?: string;
}

const require = createRequire(import.meta.url);

// Lazy accessor — avoids importing configurationManager at module load time.
// configurationManager instantiates itself (new ConfigurationManager()) when
// its module is evaluated, which calls getConfigDir() and throws if
// initializeConfigDir() hasn't been called yet. Dynamic import() defers
// module evaluation; the resolved reference is cached for sync access.
let _configManager: typeof ConfigManagerType | undefined;

export const _configManagerReady = import('./configurationManager.js')
	.then(mod => {
		_configManager = mod.configurationManager;
	})
	.catch(() => {
		// configurationManager not available (e.g. initializeConfigDir not yet called)
	});

function getConfigManager(): typeof ConfigManagerType | undefined {
	return _configManager;
}

const DEFAULT_VERSION = '0.0.0';

function getCurrentVersion(): string {
	try {
		const packageJson = require('../../package.json') as {version?: string};
		return packageJson.version ?? DEFAULT_VERSION;
	} catch {
		return DEFAULT_VERSION;
	}
}

const CURRENT_VERSION = getCurrentVersion();
let inFlight: Promise<UpdateCheckResult> | undefined;

function toComparableVersion(version: string): number[] {
	const normalized = version
		.toLowerCase()
		.replace(/^v/, '')
		.replace(/-.+$/, '');
	const parts = normalized.split('.');
	return [
		Number.parseInt(parts[0] ?? '0', 10) || 0,
		Number.parseInt(parts[1] ?? '0', 10) || 0,
		Number.parseInt(parts[2] ?? '0', 10) || 0,
	];
}

function hasNewerVersion(current: string, latest?: string): boolean {
	if (!latest) return false;
	const currentParts = toComparableVersion(current);
	const latestParts = toComparableVersion(latest);

	for (let i = 0; i < 3; i += 1) {
		const latestPart = latestParts[i] ?? 0;
		const currentPart = currentParts[i] ?? 0;
		const diff = latestPart - currentPart;
		if (diff > 0) return true;
		if (diff < 0) return false;
	}

	return false;
}

function buildResult(
	cache: UpdateCheckCacheEntry | undefined,
	source: UpdateCheckSource,
	error?: string,
): UpdateCheckResult {
	return {
		currentVersion: CURRENT_VERSION,
		checkedAt: cache?.checkedAt ?? Date.now(),
		latestVersion: cache?.latestVersion,
		latestTag: cache?.latestTag,
		isUpdateAvailable: hasNewerVersion(CURRENT_VERSION, cache?.latestVersion),
		source,
		isStale: !cache || Date.now() - cache.checkedAt > UPDATE_CHECK_TTL_MS,
		error,
	};
}

function parseTag(value: unknown): string | undefined {
	if (typeof value !== 'string') return;
	const match = value.match(/^v?(\d+\.\d+\.\d+)/);
	if (!match) return;
	return match[1];
}

function normalizeTag(tag: string): string {
	return tag.startsWith('v') ? tag.slice(1) : tag;
}

export function getCachedUpdateCheck(): UpdateCheckResult | undefined {
	const cache = getConfigManager()?.getUpdateCheck();
	if (!cache?.checkedAt) {
		return undefined;
	}

	return buildResult(
		{
			checkedAt: cache.checkedAt,
			latestVersion: cache.latestVersion
				? normalizeTag(cache.latestVersion)
				: undefined,
			latestTag: cache.latestTag,
		},
		'cache',
		cache.latestVersionError,
	);
}

export async function checkForUpdate(
	force = false,
): Promise<UpdateCheckResult> {
	const cached = getCachedUpdateCheck();
	if (process.env['NODE_ENV'] === 'test') {
		return cached ?? buildResult(undefined, 'cache');
	}

	if (!force && cached && !cached.isStale) {
		return cached;
	}

	if (inFlight) {
		return inFlight;
	}

	inFlight = (async () => {
		try {
			const response = await fetch(GITHUB_RELEASES_API, {
				headers: {
					'User-Agent': 'argusdev',
					Accept: 'application/vnd.github+json',
				},
			});

			if (!response.ok) {
				throw new Error(
					`GitHub release check failed (${response.status} ${response.statusText})`,
				);
			}

			const release = (await response.json()) as GitHubRelease;
			const parsedVersion = parseTag(release.tag_name);
			if (!parsedVersion) {
				throw new Error('GitHub release response missing numeric tag_name');
			}

			const normalizedTag = normalizeTag(release.tag_name!.trim());
			const checkedAt = Date.now();
			const entry: UpdateCheckCacheEntry = {
				checkedAt,
				latestVersion: parsedVersion,
				latestTag: normalizedTag,
			};
			getConfigManager()?.setUpdateCheck(entry);
			return buildResult(entry, 'network');
		} catch (error) {
			const existingCache = getConfigManager()?.getUpdateCheck();
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			logger.debug(`Update check failed: ${errorMessage}`);

			if (existingCache?.checkedAt) {
				return buildResult(
					{
						checkedAt: existingCache.checkedAt,
						latestVersion: existingCache.latestVersion,
						latestTag: existingCache.latestTag,
					},
					'cache',
					errorMessage,
				);
			}

			const failedCache: UpdateCheckCacheEntry = {
				checkedAt: Date.now(),
				latestVersion: undefined,
				latestVersionError: errorMessage,
			};
			getConfigManager()?.setUpdateCheck(failedCache);

			return buildResult(failedCache, 'network', errorMessage);
		} finally {
			inFlight = undefined;
		}
	})();

	return inFlight;
}

export function getCurrentVersionString(): string {
	return CURRENT_VERSION;
}
