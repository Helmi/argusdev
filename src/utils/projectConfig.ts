import {
	existsSync,
	readFileSync,
	readdirSync,
	mkdirSync,
	writeFileSync,
	unlinkSync,
} from 'fs';
import path from 'path';
import {getConfigDir} from './configDir.js';

/**
 * Project-local configuration schema
 * Loaded from .cacd.json or .cacd/config.json in project root
 */
export interface ProjectConfig {
	scripts?: {
		setup?: string;
		teardown?: string;
		[key: string]: unknown;
	};
	quickStart?: {
		work?: {
			branchTemplate?: string;
			promptTemplate?: string;
			agentId?: string;
			sessionNameTemplate?: string;
			[key: string]: unknown;
		};
		review?: {
			branchTemplate?: string;
			promptTemplate?: string;
			agentId?: string;
			sessionNameTemplate?: string;
			[key: string]: unknown;
		};
		[key: string]: unknown;
	};
	td?: {
		/** Enable td integration for this project (default: auto-detect) */
		enabled?: boolean;
		/** Auto-run `td start` when launching sessions linked to a task */
		autoStart?: boolean;
		/** Default prompt template to use for agent sessions */
		defaultPrompt?: string;
		/** Inject task context when launching an agent linked to a td task */
		injectTaskContext?: boolean;
		/** Inject td usage instructions when launching an agent linked to a td task */
		injectTdUsage?: boolean;
		[key: string]: unknown;
	};
	agentDefaults?: {
		agentId?: string;
		options?: Record<string, boolean | string>;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export type PromptTemplateSource = 'project' | 'global';
export type PromptScope = 'project' | 'global' | 'effective' | 'all';

/**
 * A prompt template stored in .cacd/prompts/ or global config prompts/
 */
export interface PromptTemplate {
	/** Filename without extension */
	name: string;
	/** Full path to the template file */
	path: string;
	/** Template content */
	content: string;
	/** Source of this template */
	source: PromptTemplateSource;
	/** Whether this template is effective in merged view */
	effective?: boolean;
	/** For global entries: overridden by a project template with same name */
	overridden?: boolean;
	/** For project entries: overrides a global template with same name */
	overridesGlobal?: boolean;
}

const GLOBAL_PROMPT_DEFAULTS: Record<string, string> = {
	'Begin Work on Task': [
		'You are working on {{task.id}} - {{task.title}}.',
		'',
		'Description:',
		'{{task.description}}',
		'',
		'Acceptance Criteria:',
		'{{task.acceptance}}',
		'',
		'Status: {{task.status}}',
		'Priority: {{task.priority}}',
		'',
		'Start by understanding scope, then implement minimal, correct changes.',
	].join('\n'),
	'Fix Rejected Work': [
		'You are continuing work on {{task.id}} - {{task.title}} after a review rejection.',
		'',
		'REJECTION REASON:',
		'{{task.rejection_reason}}',
		'',
		'Description:',
		'{{task.description}}',
		'',
		'Acceptance Criteria:',
		'{{task.acceptance}}',
		'',
		'Address the rejection feedback, then verify all acceptance criteria are met.',
	].join('\n'),
	'Code Review': [
		'Review task {{task.id}}: {{task.title}}.',
		'',
		'Focus on:',
		'- bugs and regressions',
		'- edge cases and error handling',
		'- missing tests',
		'- risky assumptions',
		'',
		'Description:',
		'{{task.description}}',
	].join('\n'),
	'Plan to Epic': [
		'Create an implementation strategy for this epic and all subtasks.',
		'',
		'Epic: {{task.id}} - {{task.title}}',
		'Priority: {{task.priority}}',
		'',
		'Cover scope, breakdown, dependencies, parallelization, and risks.',
	].join('\n'),
	'Free Session': [
		'Work on the current objective with pragmatic execution.',
		'Keep changes minimal, tested, and production-safe.',
	].join('\n'),
};

const PROMPT_FILE_EXTENSIONS = ['.md', '.txt'];
const GLOBAL_DEFAULTS_MARKER = '.defaults-seeded';

/**
 * Load project configuration from .cacd.json or .cacd/config.json
 * @param projectRoot - Path to the project root (git root)
 * @returns ProjectConfig or null if no config found
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig | null {
	const configPath = findExistingProjectConfigPath(projectRoot);
	if (!configPath) return null;

	try {
		const content = readFileSync(configPath, 'utf-8');
		const config = JSON.parse(content) as ProjectConfig;
		return config;
	} catch (error) {
		console.warn(`Failed to parse project config at ${configPath}: ${error}`);
		return null;
	}
}

/**
 * Returns existing config path if present (.cacd/config.json first, then .cacd.json).
 */
export function findExistingProjectConfigPath(
	projectRoot: string,
): string | null {
	const configPaths = [
		path.join(projectRoot, '.cacd', 'config.json'),
		path.join(projectRoot, '.cacd.json'),
	];

	for (const configPath of configPaths) {
		if (existsSync(configPath)) return configPath;
	}

	return null;
}

/**
 * Get path for project config. Uses existing file path if available,
 * otherwise returns .cacd/config.json.
 */
export function getProjectConfigPath(projectRoot: string): string {
	return (
		findExistingProjectConfigPath(projectRoot) ||
		path.join(projectRoot, '.cacd', 'config.json')
	);
}

/**
 * Persist project config to .cacd/config.json.
 * Reading still supports legacy .cacd.json for compatibility.
 */
export function saveProjectConfig(
	projectRoot: string,
	config: ProjectConfig,
): string {
	const cacdDir = path.join(projectRoot, '.cacd');
	if (!existsSync(cacdDir)) {
		mkdirSync(cacdDir, {recursive: true});
	}

	const configPath = path.join(cacdDir, 'config.json');
	writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
	return configPath;
}

/**
 * Get the .cacd/ directory path for a project.
 * Returns null if it doesn't exist.
 */
export function getCacdDir(projectRoot: string): string | null {
	const cacdDir = path.join(projectRoot, '.cacd');
	return existsSync(cacdDir) ? cacdDir : null;
}

/**
 * Get the prompts directory path (.cacd/prompts/).
 * Returns null if it doesn't exist.
 */
export function getPromptsDir(projectRoot: string): string | null {
	const promptsDir = path.join(projectRoot, '.cacd', 'prompts');
	return existsSync(promptsDir) ? promptsDir : null;
}

/**
 * Get global prompt directory path (~/.config/cacd/prompts or configured equivalent).
 */
export function getGlobalPromptsDir(): string {
	return path.join(getConfigDir(), 'prompts');
}

/**
 * Seed default global prompts once if not already seeded.
 */
export function ensureGlobalPromptDefaults(): void {
	const promptsDir = getGlobalPromptsDir();
	if (!existsSync(promptsDir)) {
		mkdirSync(promptsDir, {recursive: true});
	}

	const markerPath = path.join(promptsDir, GLOBAL_DEFAULTS_MARKER);
	if (existsSync(markerPath)) return;

	const promptFiles = listPromptFiles(promptsDir);
	if (promptFiles.length === 0) {
		for (const [name, content] of Object.entries(GLOBAL_PROMPT_DEFAULTS)) {
			const filePath = path.join(promptsDir, `${name}.md`);
			writeFileSync(filePath, `${content}\n`, 'utf-8');
		}
	}

	writeFileSync(markerPath, String(Date.now()), 'utf-8');
}

/**
 * Load all project prompt templates from .cacd/prompts/ directory.
 */
export function loadPromptTemplates(projectRoot: string): PromptTemplate[] {
	const promptsDir = getPromptsDir(projectRoot);
	if (!promptsDir) return [];
	return loadTemplatesFromDir(promptsDir, 'project');
}

/**
 * Load all global prompt templates.
 */
export function loadGlobalPromptTemplates(): PromptTemplate[] {
	ensureGlobalPromptDefaults();
	const promptsDir = getGlobalPromptsDir();
	if (!existsSync(promptsDir)) return [];
	return loadTemplatesFromDir(promptsDir, 'global');
}

/**
 * Load templates by scope.
 * - project: project-only templates
 * - global: global-only templates
 * - effective: merged templates where project overrides global on name collision
 * - all: both sources with override metadata
 */
export function loadPromptTemplatesByScope(
	projectRoot: string,
	scope: PromptScope,
): PromptTemplate[] {
	if (scope === 'global') {
		return loadGlobalPromptTemplates();
	}

	const projectTemplates = loadPromptTemplates(projectRoot);
	if (scope === 'project') {
		return projectTemplates;
	}

	const globalTemplates = loadGlobalPromptTemplates();
	const projectByName = new Map(projectTemplates.map(t => [t.name, t]));
	const globalByName = new Map(globalTemplates.map(t => [t.name, t]));

	if (scope === 'effective') {
		const names = new Set([...globalByName.keys(), ...projectByName.keys()]);
		const merged: PromptTemplate[] = [];

		for (const name of names) {
			const project = projectByName.get(name);
			if (project) {
				merged.push({
					...project,
					effective: true,
					overridesGlobal: globalByName.has(name),
				});
				continue;
			}
			const global = globalByName.get(name);
			if (global) {
				merged.push({...global, effective: true});
			}
		}

		return merged.sort((a, b) => a.name.localeCompare(b.name));
	}

	const all: PromptTemplate[] = [];
	for (const global of globalTemplates) {
		const overridden = projectByName.has(global.name);
		all.push({...global, effective: !overridden, overridden});
	}
	for (const project of projectTemplates) {
		all.push({
			...project,
			effective: true,
			overridesGlobal: globalByName.has(project.name),
		});
	}

	return all.sort((a, b) => {
		const byName = a.name.localeCompare(b.name);
		if (byName !== 0) return byName;
		return a.source.localeCompare(b.source);
	});
}

/**
 * Load a specific project prompt template by name.
 */
export function loadPromptTemplate(
	projectRoot: string,
	name: string,
): PromptTemplate | null {
	const templates = loadPromptTemplates(projectRoot);
	return templates.find(t => t.name === name) ?? null;
}

/**
 * Load a specific prompt template by scope.
 */
export function loadPromptTemplateByScope(
	projectRoot: string,
	scope: Exclude<PromptScope, 'all'>,
	name: string,
): PromptTemplate | null {
	const normalized = normalizePromptName(name);
	if (!normalized) return null;
	const templates = loadPromptTemplatesByScope(projectRoot, scope);
	return templates.find(t => t.name === normalized) ?? null;
}

/**
 * Save a prompt template to project or global scope.
 */
export function savePromptTemplateByScope(
	projectRoot: string,
	scope: Exclude<PromptScope, 'effective' | 'all'>,
	name: string,
	content: string,
): PromptTemplate {
	const normalized = normalizePromptName(name);
	if (!normalized) {
		throw new Error('Invalid prompt name');
	}

	const dir =
		scope === 'global'
			? getGlobalPromptsDir()
			: path.join(projectRoot, '.cacd', 'prompts');
	if (!existsSync(dir)) {
		mkdirSync(dir, {recursive: true});
	}

	const existingPath = findTemplatePathByName(dir, normalized);
	const filePath = existingPath || path.join(dir, `${normalized}.md`);
	writeFileSync(filePath, content, 'utf-8');

	return {
		name: normalized,
		path: filePath,
		content,
		source: scope,
	};
}

/**
 * Delete a prompt template from project or global scope.
 */
export function deletePromptTemplateByScope(
	projectRoot: string,
	scope: Exclude<PromptScope, 'effective' | 'all'>,
	name: string,
): boolean {
	const normalized = normalizePromptName(name);
	if (!normalized) return false;

	const dir =
		scope === 'global'
			? getGlobalPromptsDir()
			: path.join(projectRoot, '.cacd', 'prompts');
	if (!existsSync(dir)) return false;

	const filePath = findTemplatePathByName(dir, normalized);
	if (!filePath) return false;

	unlinkSync(filePath);
	return true;
}

/**
 * Build environment variables for hook execution
 */
export function buildHookEnvironment(opts: {
	rootPath: string;
	worktreePath: string;
	worktreeName: string;
	branch: string;
}): Record<string, string> {
	return {
		CACD_ROOT_PATH: opts.rootPath,
		CACD_WORKTREE_PATH: opts.worktreePath,
		CACD_WORKTREE_NAME: opts.worktreeName,
		CACD_BRANCH: opts.branch,
	};
}

function loadTemplatesFromDir(
	dir: string,
	source: PromptTemplateSource,
): PromptTemplate[] {
	try {
		const files = listPromptFiles(dir);
		const templates: PromptTemplate[] = [];

		for (const file of files) {
			const filePath = path.join(dir, file);
			try {
				const content = readFileSync(filePath, 'utf-8');
				const name = file.replace(/\.(md|txt)$/i, '');
				templates.push({name, path: filePath, content, source});
			} catch {
				// Skip unreadable files
			}
		}

		return templates.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

function listPromptFiles(dir: string): string[] {
	try {
		return readdirSync(dir).filter(file => {
			const lower = file.toLowerCase();
			return PROMPT_FILE_EXTENSIONS.some(ext => lower.endsWith(ext));
		});
	} catch {
		return [];
	}
}

function normalizePromptName(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return null;

	if (
		trimmed.includes('/') ||
		trimmed.includes('\\') ||
		trimmed.includes('..') ||
		trimmed.includes('\0')
	) {
		return null;
	}

	const normalized = trimmed.replace(/\.(md|txt)$/i, '').trim();
	return normalized.length > 0 ? normalized : null;
}

function findTemplatePathByName(
	dir: string,
	templateName: string,
): string | null {
	const files = listPromptFiles(dir);
	for (const file of files) {
		const name = file.replace(/\.(md|txt)$/i, '');
		if (name === templateName) {
			return path.join(dir, file);
		}
	}
	return null;
}
