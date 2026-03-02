// Environment variable names
export const ENV_VARS = {
	MULTI_PROJECT_ROOT: 'CACD_PROJECTS_DIR',
	CONFIG_DIR: 'CACD_CONFIG_DIR',
	PORT: 'CACD_PORT',
	DEV_MODE: 'CACD_DEV', // Set automatically by `npm run dev`
} as const;

/**
 * Check if running in dev mode.
 * Dev mode uses local .cacd-dev/ config directory instead of global config.
 */
export function isDevMode(): boolean {
	return process.env[ENV_VARS.DEV_MODE] === '1';
}

// Port configuration
export const PORT_RANGE = {
	MIN: 10000,
	MAX: 65535,
} as const;

/**
 * Generate a random port within the configured range.
 * Used when no port is configured on first run.
 */
export function generateRandomPort(): number {
	return (
		Math.floor(Math.random() * (PORT_RANGE.MAX - PORT_RANGE.MIN + 1)) +
		PORT_RANGE.MIN
	);
}

// GitHub release check configuration
export const GITHUB_REPO_OWNER = 'Helmi';
export const GITHUB_REPO_NAME = 'cacd';
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface UpdateCheckCacheEntry {
	checkedAt: number;
	latestVersion?: string;
	latestTag?: string;
	latestVersionError?: string;
}
