import Fastify, {FastifyInstance} from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import cors from '@fastify/cors';
import {Server} from 'socket.io';
import {coreService} from './coreService.js';
import {logger} from '../utils/logger.js';
import {configurationManager} from './configurationManager.js';
import {projectManager} from './projectManager.js';
import {authService} from './authService.js';
import {ConfigurationData, TdConfig} from '../types/index.js';
import {ValidationError} from '../types/errors.js';
import {Effect} from 'effect';
import path from 'path';
import {fileURLToPath, URL} from 'url';
import {
	getGitStatusLimited,
	getChangedFilesLimited,
	getFileDiff,
} from '../utils/gitStatus.js';
import {randomUUID, randomBytes} from 'crypto';
import {execFileSync} from 'child_process';
import {existsSync, watch, type FSWatcher} from 'fs';
import {writeFile, mkdir, readdir, unlink, stat} from 'fs/promises';
import {tmpdir} from 'os';
import {generateRandomPort, isDevMode} from '../constants/env.js';
import {
	validateWorktreePath,
	validatePathWithinBase,
	getDirectoryEntries,
	validatePathForBrowser,
} from '../utils/pathValidation.js';
import {getDefaultShell} from '../utils/platform.js';
import {tdService} from './tdService.js';
import {TdReader, type TdIssueWithChildren} from './tdReader.js';
import {
	loadProjectConfig,
	getProjectConfigPath,
	saveProjectConfig,
	loadPromptTemplatesByScope,
	loadPromptTemplateByScope,
	savePromptTemplateByScope,
	deletePromptTemplateByScope,
	type PromptScope,
	type PromptTemplate,
	type ProjectConfig,
} from '../utils/projectConfig.js';
import {sessionStore, SessionIntent} from './sessionStore.js';
import type {SessionRecord} from './sessionStore.js';
import {adapterRegistry} from '../adapters/index.js';
import {globalSessionOrchestrator} from './globalSessionOrchestrator.js';
import {fileWatcherService} from './fileWatcherService.js';
import type {SessionManager} from './sessionManager.js';
import {cleanupStartupScriptsInWorktree} from '../utils/startupScript.js';
import type {
	AgentConfig,
	Session,
	SessionState,
	StateDetectionStrategy,
} from '../types/index.js';
import {
	toApiSessionPayload,
	toSessionUpdatePayload,
	resolveSessionCreatedAtFromSource,
} from './sessionStateMetadata.js';
import {SdkSessionManager} from './sdkSessionManager.js';
import type {SdkSession, SdkEvent} from '../types/index.js';

const sdkSessionManager = new SdkSessionManager();
import {checkForUpdate, getCachedUpdateCheck} from './versionCheckService.js';

// --- Clipboard Image Paste Constants ---
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
];
const TEMP_IMAGE_DIR = path.join(tmpdir(), 'argusdev-images');
const STARTUP_SCRIPT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_SCRIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Create temp directory on module load (async, fire-and-forget)
mkdir(TEMP_IMAGE_DIR, {recursive: true, mode: 0o700}).catch(() => {});

// Cleanup old temp images (older than 1 hour)
async function cleanupTempImages() {
	try {
		const files = await readdir(TEMP_IMAGE_DIR);
		const oneHourAgo = Date.now() - 60 * 60 * 1000;

		for (const file of files) {
			const filePath = path.join(TEMP_IMAGE_DIR, file);
			try {
				const stats = await stat(filePath);
				if (stats.mtimeMs < oneHourAgo) {
					await unlink(filePath).catch(() => {});
					logger.info(`Cleaned up old temp image: ${file}`);
				}
			} catch {
				// File might have been deleted already
			}
		}
	} catch {
		// Directory might not exist yet
	}
}

// Run cleanup on startup and every hour
cleanupTempImages();
setInterval(cleanupTempImages, 60 * 60 * 1000);

async function cleanupStartupScripts(): Promise<void> {
	try {
		const worktreePaths = new Set<string>();
		for (const worktree of coreService.getState().worktrees) {
			if (worktree.path) {
				worktreePaths.add(worktree.path);
			}
		}

		let persistedSessions: Array<{worktreePath?: string}> = [];
		try {
			persistedSessions = sessionStore.querySessions({
				limit: 5000,
				offset: 0,
			}) as Array<{worktreePath?: string}>;
		} catch {
			logger.debug(
				'API: Skipping startup script cleanup due to session store read error',
			);
		}

		for (const session of persistedSessions) {
			if (session?.worktreePath) {
				worktreePaths.add(session.worktreePath);
			}
		}

		const paths = Array.from(worktreePaths);
		if (paths.length === 0) {
			return;
		}

		let removedTotal = 0;
		for (const worktreePath of paths) {
			removedTotal += await cleanupStartupScriptsInWorktree(
				worktreePath,
				STARTUP_SCRIPT_MAX_AGE_MS,
			);
		}

		if (removedTotal > 0) {
			logger.info(
				`API: Startup script cleanup removed ${removedTotal} stale launcher script(s)`,
			);
		}
	} catch (error) {
		logger.debug(`API: Startup script cleanup failed: ${String(error)}`);
	}
}

void cleanupStartupScripts();
setInterval(() => {
	void cleanupStartupScripts();
}, STARTUP_SCRIPT_CLEANUP_INTERVAL_MS);

// Check if hostname is allowed (localhost, private network IP, or local hostname)
function isAllowedHost(hostname: string): boolean {
	// Localhost variants
	if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
		return true;
	}

	// Local network hostnames (mDNS/Bonjour .local domains)
	if (hostname.endsWith('.local')) {
		return true;
	}

	// Single-word hostnames (no dots) are local network names (e.g., "helmibook")
	if (!hostname.includes('.')) {
		return true;
	}

	// Check for private network IPs (RFC 1918)
	// 10.0.0.0/8
	if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
		return true;
	}
	// 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
	if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
		return true;
	}
	// 192.168.0.0/16
	if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
		return true;
	}

	return false;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface EffectiveTdStartupConfig {
	enabled: boolean;
	autoStart: boolean;
	injectTaskContext: boolean;
	injectTdUsage: boolean;
}

interface PendingTdPromptInjection {
	prompt: string;
	taskId?: string;
	timeout: NodeJS.Timeout;
}

type SessionRecoveryMode = 'resume' | 'fallback';

interface SessionRecoveryOutcome {
	ok: boolean;
	recoveryMode: SessionRecoveryMode;
	notice?: string;
	error?: string;
}

const TD_FALLBACK_DEFAULT_PROMPT_NAME = 'Begin Work on Task';
const TD_FALLBACK_DEFAULT_PROMPT_CONTENT = [
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
].join('\n');

function findPromptTemplateByName(
	templates: PromptTemplate[],
	templateName: string,
): PromptTemplate | null {
	const normalized = templateName.trim();
	if (!normalized) return null;

	const exactMatch = templates.find(t => t.name === normalized);
	if (exactMatch) return exactMatch;

	const lowered = normalized.toLowerCase();
	return templates.find(t => t.name.toLowerCase() === lowered) ?? null;
}

function ensureGlobalTdDefaultPromptConfigured(): void {
	try {
		const tdConfig = configurationManager.getTdConfig();
		let templates = loadPromptTemplatesByScope('', 'global');

		if (templates.length === 0) {
			savePromptTemplateByScope(
				'',
				'global',
				TD_FALLBACK_DEFAULT_PROMPT_NAME,
				TD_FALLBACK_DEFAULT_PROMPT_CONTENT,
			);
			templates = loadPromptTemplatesByScope('', 'global');
		}

		if (templates.length === 0) {
			logger.warn('API: Unable to initialize TD global prompt templates');
			return;
		}

		const configuredDefault = tdConfig.defaultPrompt?.trim();
		if (
			configuredDefault &&
			findPromptTemplateByName(templates, configuredDefault)
		) {
			return;
		}

		const fallbackTemplate =
			findPromptTemplateByName(templates, TD_FALLBACK_DEFAULT_PROMPT_NAME) ||
			templates[0]!;
		configurationManager.setTdConfig({
			...tdConfig,
			defaultPrompt: fallbackTemplate.name,
		});
		logger.info(
			`API: Set TD global default prompt to "${fallbackTemplate.name}"`,
		);
	} catch (error) {
		logger.warn(`API: Failed to ensure TD global default prompt: ${error}`);
	}
}

function renderTaskPromptTemplate(
	templateContent: string,
	taskDetail: TdIssueWithChildren,
): string {
	const latestHandoff = taskDetail.handoffs[0];
	const vars: Record<string, string> = {
		'task.id': taskDetail.id,
		'task.title': taskDetail.title,
		'task.description': taskDetail.description || '',
		'task.status': taskDetail.status,
		'task.priority': taskDetail.priority,
		'task.acceptance': taskDetail.acceptance || '',
		'task.rejection_reason': taskDetail.rejectionReason || '',
		'task.type': taskDetail.type,
		'task.branch': taskDetail.created_branch,
		'task.labels': taskDetail.labels || '',
		'task.handoff.done': latestHandoff?.done.join('\n') || '',
		'task.handoff.remaining': latestHandoff?.remaining.join('\n') || '',
		'task.handoff.decisions': latestHandoff?.decisions.join('\n') || '',
		'task.handoff.uncertain': latestHandoff?.uncertain.join('\n') || '',
	};
	return templateContent.replace(
		/\{\{(task\.(?:id|title|description|status|priority|acceptance|rejection_reason|type|branch|labels|handoff\.(?:done|remaining|decisions|uncertain)))\}\}/g,
		(_match, key: string) => vars[key] || '',
	);
}

function buildTdStartupPrompt(params: {
	taskId: string;
	renderedPromptTemplate?: string | null;
	injectTdUsage: boolean;
}): string {
	const parts: string[] = [];

	if (params.injectTdUsage) {
		parts.push(
			'Use td workflow reminders: run td usage --new-session for new conversations, and td usage -q in this conversation.',
		);
	}

	parts.push(`This session is linked to td task ${params.taskId}.`);
	if (params.renderedPromptTemplate?.trim()) {
		parts.push(params.renderedPromptTemplate.trim());
	}
	return parts.join('\n\n');
}

function resolveEffectiveTdStartupConfig(
	projectConfig: ProjectConfig | null,
	globalTdConfig: TdConfig,
): EffectiveTdStartupConfig {
	return {
		enabled: projectConfig?.td?.enabled ?? globalTdConfig.enabled ?? true,
		autoStart: projectConfig?.td?.autoStart ?? globalTdConfig.autoStart ?? true,
		injectTaskContext:
			projectConfig?.td?.injectTaskContext ??
			globalTdConfig.injectTaskContext ??
			true,
		injectTdUsage:
			projectConfig?.td?.injectTdUsage ?? globalTdConfig.injectTdUsage ?? true,
	};
}

function isValidTdTaskId(taskId: string): boolean {
	const normalized = taskId.trim();
	// TD issue IDs are expected to follow the canonical "td-<alnum>" form.
	return /^td-[a-z0-9]+$/i.test(normalized);
}

function resolveSessionIntent(intent?: string): SessionIntent {
	return intent === 'work' || intent === 'review' || intent === 'fix'
		? intent
		: 'manual';
}

function inferAgentType(agent: AgentConfig): string {
	if (agent.kind === 'terminal') {
		return 'terminal';
	}

	const strategy = agent.detectionStrategy?.trim();
	if (strategy) {
		return strategy;
	}

	const command = agent.command.toLowerCase();
	if (command.includes('claude')) return 'claude';
	if (command.includes('codex')) return 'codex';
	if (command.includes('gemini')) return 'gemini';
	if (command.includes('cursor')) return 'cursor';
	if (command.includes('pi')) return 'pi';
	if (command.includes('droid')) return 'droid';
	if (command.includes('kilo')) return 'kilocode';
	if (command.includes('opencode')) return 'opencode';
	return agent.id;
}

function resolveGitField(
	worktreePath: string,
	args: string[],
): string | undefined {
	try {
		const output = execFileSync('git', ['-C', worktreePath, ...args], {
			encoding: 'utf-8',
			timeout: 3000,
		}).trim();
		return output.length > 0 ? output : undefined;
	} catch {
		return undefined;
	}
}

export class APIServer {
	private app: FastifyInstance;
	private io: Server | undefined;
	private token: string;
	private setupPromise: Promise<void>;

	// Track socket subscriptions to prevent duplicates in dev mode
	private socketSubscriptions = new Map<string, string>(); // socketId -> sessionId
	private pendingTdPromptInjections = new Map<
		string,
		PendingTdPromptInjection
	>();
	private pendingFallbackSessionEndTimes = new Map<string, number>();
	private hasRehydratedSessions = false;

	// TD issues.db file watcher for auto-refresh
	private tdDbWatcher: FSWatcher | null = null;
	private tdDbWatchDebounceTimer: NodeJS.Timeout | null = null;
	private static readonly TD_DB_WATCH_DEBOUNCE_MS = 500;

	constructor() {
		this.app = Fastify({logger: false});
		this.token = randomUUID();
		this.setupPromise = this.setup();
	}

	private clearPendingTdPromptInjection(sessionId: string): void {
		const pending = this.pendingTdPromptInjections.get(sessionId);
		if (!pending) return;
		clearTimeout(pending.timeout);
		this.pendingTdPromptInjections.delete(sessionId);
	}

	private queueTdPromptInjection(
		sessionId: string,
		prompt: string,
		taskId?: string,
	): void {
		this.clearPendingTdPromptInjection(sessionId);

		const timeout = setTimeout(() => {
			if (!this.pendingTdPromptInjections.has(sessionId)) return;
			this.pendingTdPromptInjections.delete(sessionId);
			logger.warn(
				`API: Timed out waiting for ready session state before TD startup prompt injection for session ${sessionId}${taskId ? ` (task ${taskId})` : ''}`,
			);
		}, 30000);

		this.pendingTdPromptInjections.set(sessionId, {prompt, taskId, timeout});
	}

	private isReadyForTdPromptInjection(state: SessionState): boolean {
		return state !== 'busy' && state !== 'pending_auto_approval';
	}

	private injectPendingTdPromptIfReady(session: Session): void {
		const pending = this.pendingTdPromptInjections.get(session.id);
		if (!pending) return;

		const state = session.stateMutex.getSnapshot().state;
		if (!this.isReadyForTdPromptInjection(state)) return;

		try {
			session.process.write(`${pending.prompt}\r`);
			logger.info(
				`API: Injected TD startup prompt for session ${session.id}${pending.taskId ? ` (task ${pending.taskId})` : ''}`,
			);
		} catch (err) {
			logger.warn(`API: Failed TD startup prompt injection: ${err}`);
		} finally {
			this.clearPendingTdPromptInjection(session.id);
		}
	}

	private normalizeRecoveryOptions(
		rawOptions: Record<string, unknown>,
	): Record<string, boolean | string> {
		const normalized: Record<string, boolean | string> = {};
		for (const [key, value] of Object.entries(rawOptions || {})) {
			if (typeof value === 'boolean') {
				normalized[key] = value;
				continue;
			}
			if (typeof value === 'string') {
				const trimmed = value.trim();
				if (trimmed.length > 0) {
					normalized[key] = trimmed;
				}
			}
		}
		return normalized;
	}

	private applyRecoveryResumeOptions(
		agent: AgentConfig,
		options: Record<string, boolean | string>,
		record: SessionRecord,
	): {options: Record<string, boolean | string>; usedResumeHint: boolean} {
		const next = {...options};
		const hasActiveValue = (value: boolean | string | undefined): boolean =>
			value !== undefined && value !== false && value !== '';

		const resumeModeOptions = agent.options.filter(
			option => option.group === 'resume-mode',
		);
		const hasResumeModeSet = resumeModeOptions.some(option =>
			hasActiveValue(next[option.id]),
		);

		if (hasResumeModeSet) {
			return {options: next, usedResumeHint: true};
		}

		const findOption = (id: string) =>
			agent.options.find(option => option.id === id);
		const setIfAvailable = (
			id: string,
			value: boolean | string | undefined,
		): boolean => {
			const option = findOption(id);
			if (!option) return false;
			if (option.type === 'boolean') {
				next[id] = value === true;
				return value === true;
			}
			if (option.type === 'string' && typeof value === 'string' && value) {
				next[id] = value;
				return true;
			}
			return false;
		};

		if (
			record.agentSessionPath &&
			setIfAvailable('session', record.agentSessionPath)
		) {
			return {options: next, usedResumeHint: true};
		}

		if (
			record.agentSessionId &&
			setIfAvailable('resume', record.agentSessionId)
		) {
			return {options: next, usedResumeHint: true};
		}

		if (setIfAvailable('continue', true)) {
			return {options: next, usedResumeHint: true};
		}

		const usedResumeHint = setIfAvailable('resume', true);
		return {options: next, usedResumeHint};
	}

	private resolveRecoveryAgent(record: SessionRecord): AgentConfig {
		const configuredAgent =
			configurationManager.getAgentById(record.agentProfileId) ||
			configurationManager.getAgentById(record.agentType);
		if (configuredAgent) {
			return configuredAgent;
		}

		const adapter =
			adapterRegistry.getById(record.agentType) ||
			adapterRegistry.getByAgentType(record.agentType);
		const fallbackCommand = adapter?.command || record.agentType || 'sh';
		const fallbackStrategy = adapter?.detectionStrategy;

		return {
			id: record.agentProfileId || record.agentType || 'restored-agent',
			name: record.agentProfileName || record.agentType || 'Restored Agent',
			kind: 'agent',
			command: fallbackCommand,
			options: [],
			detectionStrategy: fallbackStrategy as StateDetectionStrategy | undefined,
		};
	}

	private applyCodexRecoveryArgs(
		agent: AgentConfig,
		record: SessionRecord,
		args: string[],
	): {args: string[]; usedResumeHint: boolean} {
		const command = agent.command.trim().split(/\s+/)[0]?.toLowerCase();
		if (agent.id !== 'codex' && command !== 'codex') {
			return {args, usedResumeHint: false};
		}

		const firstArg = args[0]?.toLowerCase();
		if (firstArg === 'resume' || firstArg === 'fork') {
			return {args, usedResumeHint: true};
		}

		const sessionId = record.agentSessionId?.trim();
		return {
			args: ['resume', sessionId || '--last', ...args],
			usedResumeHint: true,
		};
	}

	private buildRestartFallbackPrompt(record: SessionRecord): string {
		const lines = [
			`This session (${record.id}) was restarted by ArgusDev.`,
			'',
			'Resume context safely:',
			`1) Review recent session history${record.agentSessionPath ? ` in ${record.agentSessionPath}` : ''}.`,
			`2) Continue work in ${record.worktreePath}.`,
			'3) Re-state the exact next step before making changes.',
		];

		if (record.tdTaskId) {
			lines.push(`4) Keep task linkage intact: ${record.tdTaskId}.`);
		}

		return lines.join('\n');
	}

	private markRecoveryFailed(sessionId: string): void {
		try {
			sessionStore.markSessionEnded(sessionId);
		} catch (error) {
			logger.warn(
				`API: Failed to mark unrecoverable session ${sessionId} as ended: ${String(error)}`,
			);
		}
	}

	private persistSessionMetadataIfMissing(session: Session): void {
		try {
			if (sessionStore.getSessionById(session.id)) {
				return;
			}

			const configuredAgent = session.agentId
				? configurationManager.getAgentById(session.agentId)
				: undefined;
			const detectedAgentType = configuredAgent
				? adapterRegistry.getById(configuredAgent.id)?.id ||
					adapterRegistry.getByAgentType(inferAgentType(configuredAgent))?.id ||
					inferAgentType(configuredAgent)
				: session.detectionStrategy || session.agentId || 'terminal';
			const createdAt = resolveSessionCreatedAtFromSource(session);

			sessionStore.createSessionRecord({
				id: session.id,
				agentProfileId:
					configuredAgent?.id || session.agentId || detectedAgentType,
				agentProfileName:
					configuredAgent?.name || session.agentId || detectedAgentType,
				agentType: detectedAgentType,
				agentOptions: {},
				worktreePath: session.worktreePath,
				branchName: resolveGitField(session.worktreePath, [
					'branch',
					'--show-current',
				]),
				projectPath: resolveGitField(session.worktreePath, [
					'rev-parse',
					'--show-toplevel',
				]),
				sessionName: session.name,
				intent: 'manual',
				createdAt,
			});

			sessionStore.scheduleAgentSessionDiscovery({
				sessionId: session.id,
				agentType: detectedAgentType,
				worktreePath: session.worktreePath,
			});

			const pendingEndedAt = this.pendingFallbackSessionEndTimes.get(
				session.id,
			);
			if (pendingEndedAt) {
				sessionStore.markSessionEnded(session.id, pendingEndedAt);
				this.pendingFallbackSessionEndTimes.delete(session.id);
			}
		} catch (error) {
			logger.warn(
				`API: Failed to persist fallback session metadata for ${session.id}: ${String(error)}`,
			);
		}
	}

	private async recoverSessionFromRecord(
		record: SessionRecord,
		options: {
			injectFallbackPrompt?: boolean;
			markEndedOnFailure?: boolean;
			targetManager?: SessionManager;
		} = {},
	): Promise<SessionRecoveryOutcome> {
		const injectFallbackPrompt = options.injectFallbackPrompt ?? false;
		const markEndedOnFailure = options.markEndedOnFailure ?? true;
		const manager = options.targetManager ?? coreService.sessionManager;

		try {
			const agent = this.resolveRecoveryAgent(record);
			const normalizedOptions = this.normalizeRecoveryOptions(
				record.agentOptions,
			);
			const resumeOptionPlan = this.applyRecoveryResumeOptions(
				agent,
				normalizedOptions,
				record,
			);
			const builtArgs = configurationManager.buildAgentArgs(
				agent,
				resumeOptionPlan.options,
			);
			const codexArgsPlan = this.applyCodexRecoveryArgs(
				agent,
				record,
				builtArgs,
			);
			const recoveryMode: SessionRecoveryMode =
				resumeOptionPlan.usedResumeHint || codexArgsPlan.usedResumeHint
					? 'resume'
					: 'fallback';
			const command =
				agent.command === '$SHELL' ? getDefaultShell() : agent.command;
			const extraEnv: Record<string, string> = {};
			if (record.tdTaskId) {
				extraEnv['TD_TASK_ID'] = record.tdTaskId;
			}
			if (record.tdSessionId) {
				extraEnv['TD_SESSION_ID'] = record.tdSessionId;
			}
			const promptArg = agent.promptArg?.trim();
			const canInjectFallbackPrompt =
				recoveryMode === 'fallback' &&
				injectFallbackPrompt &&
				agent.kind !== 'terminal' &&
				promptArg?.toLowerCase() !== 'none';
			const fallbackPrompt = this.buildRestartFallbackPrompt(record);

			const effect = manager.createSessionWithAgentEffect(
				record.worktreePath,
				command,
				codexArgsPlan.args,
				agent.detectionStrategy,
				record.sessionName || undefined,
				agent.id,
				Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
				agent.kind,
				{
					promptArg,
					prependCwd: agent.prependCwd,
					sessionIdOverride: record.id,
					initialPrompt: canInjectFallbackPrompt ? fallbackPrompt : undefined,
				},
			);
			const result = await Effect.runPromise(Effect.either(effect));
			if (result._tag === 'Left') {
				if (markEndedOnFailure) {
					this.markRecoveryFailed(record.id);
				}
				return {
					ok: false,
					recoveryMode,
					error: result.left.message,
				};
			}

			manager.setSessionActive(record.id, true);

			if (
				recoveryMode === 'fallback' &&
				injectFallbackPrompt &&
				!canInjectFallbackPrompt
			) {
				try {
					result.right.process.write(`${fallbackPrompt}\r`);
				} catch (error) {
					logger.warn(
						`API: Failed to inject fallback restart prompt for ${record.id}: ${String(error)}`,
					);
				}
			}

			return {
				ok: true,
				recoveryMode,
				notice:
					recoveryMode === 'fallback'
						? 'Session restarted without deterministic resume. ArgusDev started a fresh session with a recovery prompt.'
						: undefined,
			};
		} catch (error) {
			if (markEndedOnFailure) {
				this.markRecoveryFailed(record.id);
			}
			return {
				ok: false,
				recoveryMode: 'fallback',
				error: String(error),
			};
		}
	}

	private async rehydratePersistedSessions(): Promise<void> {
		const recoverableSessions = sessionStore
			.querySessions({limit: 5000, offset: 0})
			.filter(record => record.endedAt === null)
			.sort((a, b) => a.createdAt - b.createdAt);

		if (recoverableSessions.length === 0) {
			logger.info('API: No persisted live sessions found for recovery');
			return;
		}

		let restoredCount = 0;
		for (const record of recoverableSessions) {
			if (coreService.sessionManager.getSession(record.id)) {
				continue;
			}
			const outcome = await this.recoverSessionFromRecord(record, {
				injectFallbackPrompt: false,
				markEndedOnFailure: true,
			});
			if (!outcome.ok) {
				logger.warn(
					`API: Failed to recover session ${record.id}: ${outcome.error || 'unknown error'}`,
				);
				continue;
			}
			restoredCount += 1;
		}

		logger.info(
			`API: Session recovery complete (${restoredCount}/${recoverableSessions.length} restored)`,
		);
	}

	private async setup(): Promise<void> {
		// Register cookie plugin for session management
		await this.app.register(fastifyCookie, {
			secret: randomUUID(), // Used for signing cookies
		});

		// Register CORS - allow localhost and private network origins
		await this.app.register(cors, {
			origin: (origin, cb) => {
				// Allow requests with no origin (like curl, mobile apps)
				if (!origin) {
					cb(null, true);
					return;
				}
				// Allow localhost and private network origins
				try {
					const url = new URL(origin);
					const allowed = isAllowedHost(url.hostname);
					if (isDevMode()) {
						logger.info(
							`CORS check: origin=${origin} hostname=${url.hostname} allowed=${allowed}`,
						);
					}
					if (allowed) {
						cb(null, true);
					} else {
						logger.warn(`CORS rejected origin: ${origin}`);
						cb(new Error('Not allowed by CORS'), false);
					}
				} catch (_e) {
					logger.warn(`CORS invalid origin: ${origin}`);
					cb(new Error('Invalid origin'), false);
				}
			},
			credentials: true, // Allow cookies
		});

		// Host header validation middleware (DNS rebinding protection)
		this.app.addHook('preHandler', async (request, reply) => {
			const host = request.headers.host?.split(':')[0];
			if (host && !isAllowedHost(host)) {
				logger.warn(`Blocked request with invalid Host header: ${host}`);
				return reply.status(403).send({error: 'Invalid host'});
			}
		});

		// Register Static Files (Serve the React App)
		const clientDistPath = path.resolve(__dirname, '../../client/dist');

		try {
			await this.app.register(fastifyStatic, {
				root: clientDistPath,
				prefix: '/',
			});
			logger.info(`Serving static files from ${clientDistPath}`);

			// SPA fallback: serve index.html for non-API routes (React handles routing)
			this.app.setNotFoundHandler(async (request, reply) => {
				// Don't intercept API routes - let them 404 normally
				if (request.url.startsWith('/api/')) {
					return reply.status(404).send({error: 'Not Found', statusCode: 404});
				}
				// Serve index.html for all other routes (SPA client-side routing)
				return reply.sendFile('index.html');
			});
		} catch (_e) {
			logger.warn(
				`Failed to register static files from ${clientDistPath}. Client might not be built.`,
			);
		}

		ensureGlobalTdDefaultPromptConfigured();
		this.setupRoutes();
		this.setupSocketHandlers();
		this.setupCoreListeners();
		this.setupSdkListeners();
	}

	private setupRoutes() {
		const resolveSelectedProjectTdContext = () => {
			const project = coreService.getSelectedProject();
			if (!project) {
				return {
					project: null,
					projectConfig: null as ProjectConfig | null,
					projectState: null as ReturnType<
						typeof tdService.resolveProjectState
					> | null,
				};
			}

			const projectConfig = loadProjectConfig(project.path);
			const globalTdConfig = configurationManager.getTdConfig();
			const tdEnabled =
				projectConfig?.td?.enabled ?? globalTdConfig.enabled ?? true;
			const rawProjectState = tdService.resolveProjectState(project.path);
			const projectState = !tdEnabled
				? {
						...rawProjectState,
						enabled: false,
					}
				: rawProjectState;

			return {project, projectConfig, projectState};
		};

		// --- Authentication Routes (public) ---

		// Check auth status - returns whether user has valid session
		this.app.get('/api/auth/status', async request => {
			const sessionId = request.cookies['argusdev_session'];
			if (!sessionId) {
				return {authenticated: false};
			}

			const session = authService.validateSession(sessionId);
			return {
				authenticated: !!session,
				expiresAt: session?.expiresAt,
			};
		});

		// Verify passcode and create session
		this.app.post<{Body: {passcode: string}}>(
			'/api/auth/passcode',
			async (request, reply) => {
				const ip = request.ip || 'unknown';

				// Check rate limiting
				const rateLimit = authService.checkRateLimit(ip);
				if (!rateLimit.allowed) {
					reply.status(429);
					return {
						success: false,
						error: 'Too many attempts',
						retryAfter: rateLimit.retryAfter,
					};
				}

				const {passcode} = request.body;
				if (!passcode) {
					reply.status(400);
					return {success: false, error: 'Passcode required'};
				}

				// Get stored passcode hash from config
				const config = configurationManager.getConfiguration();
				const passcodeHash = config.passcodeHash;

				if (!passcodeHash) {
					// No passcode set - this shouldn't happen if onboarding completed
					reply.status(500);
					return {success: false, error: 'Authentication not configured'};
				}

				// Verify passcode
				const valid = await authService.verifyPasscode(passcode, passcodeHash);
				authService.recordAttempt(ip, valid);

				if (!valid) {
					const updatedRateLimit = authService.checkRateLimit(ip);
					reply.status(401);
					return {
						success: false,
						error: 'Invalid passcode',
						attemptsRemaining: updatedRateLimit.attemptsRemaining,
					};
				}

				// Create session and set cookie
				const session = authService.createSession();
				reply.setCookie('argusdev_session', session.id, {
					path: '/',
					httpOnly: true,
					sameSite: 'strict',
					maxAge: 7 * 24 * 60 * 60, // 7 days
				});

				logger.info('User authenticated successfully');
				return {success: true};
			},
		);

		// Logout - invalidate session
		this.app.post('/api/auth/logout', async (request, reply) => {
			const sessionId = request.cookies['argusdev_session'];
			if (sessionId) {
				authService.invalidateSession(sessionId);
			}

			reply.clearCookie('argusdev_session', {path: '/'});
			return {success: true};
		});

		// Validate access token (for token-based URL access)
		this.app.get('/api/auth/validate-token', async request => {
			const config = configurationManager.getConfiguration();
			const storedToken = config.accessToken;

			// If no token is configured, auth is not set up
			if (!storedToken) {
				return {valid: false, reason: 'not_configured'};
			}

			// Get token from query parameter
			const providedToken = (request.query as {token?: string}).token;
			if (!providedToken || providedToken !== storedToken) {
				return {valid: false, reason: 'invalid_token'};
			}

			return {valid: true, authRequired: !!config.passcodeHash};
		});

		// --- Session Middleware for Protected Routes ---
		// All /api/* routes (except auth) require valid session
		this.app.addHook('preHandler', async (request, reply) => {
			// Skip auth routes
			if (request.url.startsWith('/api/auth/')) {
				return;
			}

			// Skip non-API routes
			if (!request.url.startsWith('/api/')) {
				return;
			}

			// Allow API access token header (used by trusted local TUI clients)
			const configuredAccessToken = configurationManager.getAccessToken();
			const accessTokenHeader = request.headers['x-access-token'];
			const providedAccessToken = Array.isArray(accessTokenHeader)
				? accessTokenHeader[0]
				: accessTokenHeader;
			if (
				configuredAccessToken &&
				providedAccessToken === configuredAccessToken
			) {
				return;
			}

			// Check for valid session
			const sessionId = request.cookies['argusdev_session'];
			if (!sessionId) {
				return reply.status(401).send({error: 'Authentication required'});
			}

			const session = authService.validateSession(sessionId);
			if (!session) {
				reply.clearCookie('argusdev_session', {path: '/'});
				return reply.status(401).send({error: 'Session expired'});
			}

			// Session is valid, continue
		});

		// --- State ---
		this.app.get('/api/state', async () => {
			return {
				...coreService.getState(),
				isDevMode: isDevMode(),
				updateInfo: getCachedUpdateCheck(),
			};
		});

		// --- Projects (registry-based API) ---
		this.app.get('/api/projects', async () => {
			const pm = projectManager.instance;

			// Validate projects (marks invalid paths)
			pm.validateProjects();

			// Get all projects from registry, sorted by lastAccessed
			const projects = pm.getProjects();

			logger.info(`API: Fetched ${projects.length} projects from registry`);

			return {
				projects: projects,
			};
		});

		this.app.post<{Body: {path: string; name?: string}}>(
			'/api/project/add',
			async (request, reply) => {
				const {path, name} = request.body;
				const result = projectManager.addProject(path, name);

				if (result) {
					logger.info(`API: Added project ${result.name}`);
					coreService.emitProjectAdded(result.path);
					return {success: true, project: result};
				} else {
					logger.error(`API: Failed to add project: ${path}`);
					reply.status(400);
					return {success: false, error: 'Not a valid git repository'};
				}
			},
		);

		this.app.post<{Body: {path: string}}>(
			'/api/project/remove',
			async (request, reply) => {
				const {path} = request.body;
				const removed = projectManager.removeProject(path);

				if (removed) {
					logger.info(`API: Removed project: ${path}`);
					coreService.emitProjectRemoved(path);
					return {success: true};
				} else {
					logger.error(`API: Failed to remove project (not found): ${path}`);
					reply.status(404);
					return {success: false, error: 'Project not found'};
				}
			},
		);

		this.app.post<{Body: {path: string; name?: string; description?: string}}>(
			'/api/project/update',
			async (request, reply) => {
				const {path, name, description} = request.body;
				const updated = projectManager.instance.updateProject(path, {
					name,
					description,
				});

				if (updated) {
					logger.info(
						`API: Updated project ${path} -> name: ${name}, description: ${description}`,
					);
					return {success: true, project: updated};
				} else {
					logger.error(`API: Failed to update project (not found): ${path}`);
					reply.status(404);
					return {success: false, error: 'Project not found'};
				}
			},
		);

		this.app.post<{Body: {path: string}}>(
			'/api/project/select',
			async (request, reply) => {
				const {path} = request.body;
				const pm = projectManager.instance;

				// Get project from registry
				const project = pm.getProject(path);

				if (!project) {
					return reply.code(404).send({error: 'Project not found in registry'});
				}

				// Block selection of invalid projects
				if (project.isValid === false) {
					return reply
						.code(400)
						.send({error: 'Project path is invalid or no longer exists'});
				}

				// Convert to GitProject and select (updates lastAccessed automatically)
				const gitProject = pm.toGitProject(project);
				pm.selectProject(gitProject);
				await coreService.selectProject(gitProject);

				return {success: true};
			},
		);

		this.app.post('/api/project/reset', async () => {
			coreService.resetProject();
			return {success: true};
		});

		this.app.get<{Querystring: {projectPath?: string}}>(
			'/api/project/config',
			async (request, reply) => {
				const requestedProjectPath = request.query.projectPath?.trim();
				let projectPath: string | null = null;

				if (requestedProjectPath) {
					const project =
						projectManager.instance.getProject(requestedProjectPath);
					if (!project) {
						return reply
							.code(404)
							.send({error: 'Project not found in registry'});
					}
					if (project.isValid === false) {
						return reply
							.code(400)
							.send({error: 'Project path is invalid or no longer exists'});
					}
					projectPath = project.path;
				} else {
					projectPath = coreService.getSelectedProject()?.path || null;
					if (!projectPath) {
						return reply.code(400).send({error: 'No project selected'});
					}
				}

				const config = loadProjectConfig(projectPath) || {};
				const configPath = getProjectConfigPath(projectPath);
				return {config, configPath};
			},
		);

		this.app.post<{Body: {config: Record<string, unknown>}}>(
			'/api/project/config',
			async (request, reply) => {
				const project = coreService.getSelectedProject();
				if (!project) {
					return reply.code(400).send({error: 'No project selected'});
				}

				const nextConfig = request.body?.config;
				if (!nextConfig || typeof nextConfig !== 'object') {
					return reply.code(400).send({error: 'config object is required'});
				}

				try {
					const configPath = saveProjectConfig(
						project.path,
						nextConfig as ProjectConfig,
					);
					return {success: true, configPath};
				} catch (error) {
					logger.warn(`API: Failed to save project config: ${error}`);
					return reply.code(500).send({error: 'Failed to save project config'});
				}
			},
		);

		// --- Directory Browser (for Add Project) ---

		// Browse directories for file picker
		this.app.get<{
			Querystring: {path?: string; showHidden?: string};
		}>('/api/browse', async request => {
			const {path: dirPath, showHidden} = request.query;

			// Default to home directory if no path provided
			const targetPath = dirPath || '~';
			const includeHidden = showHidden === 'true';

			logger.info(`API: Browsing directory: ${targetPath}`);
			const result = getDirectoryEntries(targetPath, includeHidden);

			return result;
		});

		// Validate a path for the project picker
		this.app.get<{
			Querystring: {path: string};
		}>('/api/validate-path', async (request, reply) => {
			const {path: inputPath} = request.query;

			if (!inputPath) {
				return reply.code(400).send({error: 'path query parameter required'});
			}

			const result = validatePathForBrowser(inputPath);
			return result;
		});

		// --- Worktrees ---
		// Returns worktrees for ALL registered projects
		this.app.get('/api/worktrees', async () => {
			const projects = projectManager.getProjects();
			const allWorktrees: Array<{
				path: string;
				branch?: string;
				isMainWorktree: boolean;
				hasSession: boolean;
				gitStatus?: {
					filesAdded: number;
					filesDeleted: number;
					aheadCount: number;
					behindCount: number;
					parentBranch: string | null;
				};
				gitStatusError?: string;
			}> = [];

			for (const project of projects) {
				if (!project.isValid) continue;
				try {
					const worktreeService = projectManager.instance.getWorktreeService(
						project.path,
					);
					const result = await Effect.runPromise(
						Effect.either(worktreeService.getWorktreesEffect()),
					);
					if (result._tag === 'Right') {
						// Fetch git status for each worktree in parallel
						const worktreesWithStatus = await Promise.all(
							result.right.map(async wt => {
								const gitResult = await Effect.runPromise(
									Effect.either(getGitStatusLimited(wt.path)),
								);
								return {
									...wt,
									gitStatus:
										gitResult._tag === 'Right' ? gitResult.right : undefined,
									gitStatusError:
										gitResult._tag === 'Left'
											? gitResult.left.message
											: undefined,
								};
							}),
						);
						for (const wt of worktreesWithStatus) {
							allWorktrees.push(wt);
						}
					}
				} catch (error) {
					logger.warn(
						`Failed to get worktrees for project ${project.path}:`,
						error,
					);
				}
			}

			// Update hasSession using all active sessions across all managers
			const allSessions = globalSessionOrchestrator.getAllActiveSessions();
			for (const wt of allWorktrees) {
				wt.hasSession = allSessions.some(s => s.worktreePath === wt.path);
			}

			return allWorktrees;
		});

		// --- Git Status Endpoints ---
		// Get list of changed files for a worktree
		this.app.get<{
			Querystring: {path: string};
		}>('/api/worktree/files', async (request, reply) => {
			const {path: worktreePath} = request.query;

			if (!worktreePath) {
				return reply.code(400).send({error: 'path query parameter required'});
			}

			// Validate worktree path is a real git directory
			let validatedPath: string;
			try {
				validatedPath = validateWorktreePath(worktreePath);
			} catch (_error) {
				logger.warn(`Invalid worktree path requested: ${worktreePath}`);
				return reply.code(400).send({error: 'Invalid worktree path'});
			}

			const result = await Effect.runPromise(
				Effect.either(getChangedFilesLimited(validatedPath)),
			);

			if (result._tag === 'Left') {
				return reply.code(500).send({error: result.left.message});
			}

			return result.right;
		});

		// Get diff for a specific file in a worktree
		this.app.get<{
			Querystring: {path: string; file: string};
		}>('/api/worktree/diff', async (request, reply) => {
			const {path: worktreePath, file: filePath} = request.query;

			if (!worktreePath || !filePath) {
				return reply
					.code(400)
					.send({error: 'path and file query parameters required'});
			}

			// Validate worktree path is a real git directory
			let validatedWorktreePath: string;
			try {
				validatedWorktreePath = validateWorktreePath(worktreePath);
			} catch (_error) {
				logger.warn(`Invalid worktree path requested: ${worktreePath}`);
				return reply.code(400).send({error: 'Invalid worktree path'});
			}

			// Validate file path doesn't escape worktree (prevents ../../../etc/passwd)
			try {
				validatePathWithinBase(validatedWorktreePath, filePath);
			} catch (_error) {
				logger.warn(
					`Path traversal attempt blocked: ${filePath} in ${worktreePath}`,
				);
				return reply.code(400).send({error: 'Invalid file path'});
			}

			const result = await Effect.runPromise(
				Effect.either(getFileDiff(validatedWorktreePath, filePath)),
			);

			if (result._tag === 'Left') {
				return reply.code(500).send({error: result.left.message});
			}

			return {diff: result.right};
		});

		// Get directory listing for file browser
		this.app.get<{
			Querystring: {path: string; dir?: string};
		}>('/api/worktree/tree', async (request, reply) => {
			const {path: worktreePath, dir: subDir} = request.query;

			if (!worktreePath) {
				return reply.code(400).send({error: 'path query parameter required'});
			}

			// Validate worktree path is a real git directory
			let validatedWorktreePath: string;
			try {
				validatedWorktreePath = validateWorktreePath(worktreePath);
			} catch (_error) {
				logger.warn(`Invalid worktree path requested: ${worktreePath}`);
				return reply.code(400).send({error: 'Invalid worktree path'});
			}

			// Validate subdir if provided
			let targetDir = validatedWorktreePath;
			if (subDir) {
				try {
					targetDir = validatePathWithinBase(validatedWorktreePath, subDir);
				} catch (_error) {
					logger.warn(
						`Path traversal attempt blocked: ${subDir} in ${worktreePath}`,
					);
					return reply.code(400).send({error: 'Invalid directory path'});
				}
			}

			try {
				const fs = await import('fs/promises');
				const entries = await fs.readdir(targetDir, {withFileTypes: true});

				interface DirectoryEntry {
					name: string;
					path: string;
					type: 'file' | 'directory';
					size?: number;
				}

				const result: DirectoryEntry[] = [];

				for (const entry of entries) {
					// Skip .git directory
					if (entry.name === '.git') continue;

					const relativePath = subDir ? `${subDir}/${entry.name}` : entry.name;

					if (entry.isDirectory()) {
						result.push({
							name: entry.name,
							path: relativePath,
							type: 'directory',
						});
					} else if (entry.isFile()) {
						// Get file size
						const fullPath = path.join(targetDir, entry.name);
						try {
							const stat = await fs.stat(fullPath);
							result.push({
								name: entry.name,
								path: relativePath,
								type: 'file',
								size: stat.size,
							});
						} catch {
							// Skip files we can't stat
							continue;
						}
					}
				}

				// Sort: directories first, then alphabetically
				result.sort((a, b) => {
					if (a.type !== b.type) {
						return a.type === 'directory' ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				});

				return {entries: result};
			} catch (error) {
				logger.error(`Failed to read directory: ${targetDir}`, error);
				return reply.code(500).send({error: 'Failed to read directory'});
			}
		});

		// Get file content for file viewer
		this.app.get<{
			Querystring: {path: string; file: string};
		}>('/api/worktree/file', async (request, reply) => {
			const {path: worktreePath, file: filePath} = request.query;

			if (!worktreePath || !filePath) {
				return reply
					.code(400)
					.send({error: 'path and file query parameters required'});
			}

			// Validate worktree path
			let validatedWorktreePath: string;
			try {
				validatedWorktreePath = validateWorktreePath(worktreePath);
			} catch (_error) {
				logger.warn(`Invalid worktree path requested: ${worktreePath}`);
				return reply.code(400).send({error: 'Invalid worktree path'});
			}

			// Validate file path doesn't escape worktree
			let fullPath: string;
			try {
				fullPath = validatePathWithinBase(validatedWorktreePath, filePath);
			} catch (_error) {
				logger.warn(
					`Path traversal attempt blocked: ${filePath} in ${worktreePath}`,
				);
				return reply.code(400).send({error: 'Invalid file path'});
			}

			try {
				const fs = await import('fs/promises');
				const stat = await fs.stat(fullPath);

				// Max 1MB file size
				const MAX_SIZE = 1024 * 1024;
				if (stat.size > MAX_SIZE) {
					return {
						content: '',
						size: stat.size,
						isBinary: false,
						tooLarge: true,
					};
				}

				// Read file content
				const buffer = await fs.readFile(fullPath);

				// Simple binary detection: check for null bytes in first 8KB
				const sampleSize = Math.min(8192, buffer.length);
				let isBinary = false;
				for (let i = 0; i < sampleSize; i++) {
					if (buffer[i] === 0) {
						isBinary = true;
						break;
					}
				}

				if (isBinary) {
					return {
						content: '',
						size: stat.size,
						isBinary: true,
					};
				}

				return {
					content: buffer.toString('utf8'),
					size: stat.size,
					isBinary: false,
				};
			} catch (error) {
				logger.error(`Failed to read file: ${fullPath}`, error);
				return reply.code(500).send({error: 'Failed to read file'});
			}
		});

		this.app.get<{
			Querystring: {projectPath?: string};
		}>('/api/branches', async (request, reply) => {
			const {projectPath} = request.query;

			// If projectPath provided, get branches for that specific project
			if (projectPath) {
				// Validate project path is a real git directory
				let validatedPath: string;
				try {
					validatedPath = validateWorktreePath(projectPath);
				} catch (_error) {
					logger.warn(`Invalid project path requested: ${projectPath}`);
					return reply.code(400).send({error: 'Invalid project path'});
				}

				try {
					const {execFileSync} = await import('child_process');
					const output = execFileSync(
						'git',
						['branch', '-a', '--format=%(refname:short)'],
						{
							cwd: validatedPath,
							encoding: 'utf8',
						},
					);

					const branches = output
						.split('\n')
						.map((b: string) => b.trim())
						.filter((b: string) => b.length > 0 && !b.includes('HEAD'))
						.map((b: string) => b.replace(/^origin\//, ''))
						.filter(
							(b: string, i: number, arr: string[]) => arr.indexOf(b) === i,
						)
						.sort();

					return branches;
				} catch (error) {
					logger.error(`Failed to get branches for ${projectPath}:`, error);
					return [];
				}
			}

			// Fallback to current worktree service (for backwards compatibility)
			const effect = coreService.worktreeService.getAllBranchesEffect();
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				return reply.code(500).send({error: result.left.message});
			}
			return result.right;
		});

		this.app.get<{
			Querystring: {projectPath?: string};
		}>('/api/branches/default', async (request, reply) => {
			const {projectPath} = request.query;

			try {
				const worktreeService = projectPath
					? projectManager.instance.getWorktreeService(projectPath)
					: coreService.worktreeService;
				const result = await Effect.runPromise(
					Effect.either(worktreeService.getDefaultBranchEffect()),
				);

				if (result._tag === 'Left') {
					return reply.code(500).send({error: result.left.message});
				}

				return {defaultBranch: result.right};
			} catch (error) {
				return reply.code(500).send({error: String(error)});
			}
		});

		this.app.post<{
			Body: {
				path: string;
				branch: string;
				baseBranch: string;
				copySessionData: boolean;
				copyClaudeDirectory: boolean;
				projectPath?: string;
			};
		}>('/api/worktree/create', async (request, reply) => {
			const {
				path,
				branch,
				baseBranch,
				copySessionData,
				copyClaudeDirectory,
				projectPath,
			} = request.body;
			logger.info(
				`API: Creating worktree ${path} from ${baseBranch} in project ${projectPath || 'default'}`,
			);

			// Get worktree service for the specified project, or fall back to default
			const worktreeService = projectPath
				? projectManager.instance.getWorktreeService(projectPath)
				: coreService.worktreeService;

			const effect = worktreeService.createWorktreeEffect(
				path,
				branch,
				baseBranch,
				copySessionData,
				copyClaudeDirectory,
			);
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				return reply.code(500).send({error: result.left.message});
			}

			// Refresh worktrees
			await coreService.refreshWorktrees();
			return {
				success: true,
				warnings: result.right.warnings,
				worktree: result.right,
			};
		});

		this.app.post<{
			Body: {path: string; deleteBranch: boolean; projectPath?: string};
		}>('/api/worktree/delete', async (request, reply) => {
			const {path, deleteBranch, projectPath} = request.body;
			logger.info(
				`API: Deleting worktree ${path} (deleteBranch: ${deleteBranch}) in project ${projectPath || 'default'}`,
			);

			// Get worktree service for the specified project, or fall back to default
			const worktreeService = projectPath
				? projectManager.instance.getWorktreeService(projectPath)
				: coreService.worktreeService;

			const effect = worktreeService.deleteWorktreeEffect(path, {
				deleteBranch,
			});
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				return reply.code(500).send({error: result.left.message});
			}

			await coreService.refreshWorktrees();
			return {success: true};
		});

		this.app.post<{
			Body: {sourceBranch: string; targetBranch: string; useRebase: boolean};
		}>('/api/worktree/merge', async (request, reply) => {
			const {sourceBranch, targetBranch, useRebase} = request.body;
			logger.info(
				`API: Merging ${sourceBranch} into ${targetBranch} (rebase: ${useRebase})`,
			);

			const effect = coreService.worktreeService.mergeWorktreeEffect(
				sourceBranch,
				targetBranch,
				useRebase,
			);
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				return reply.code(500).send({error: result.left.message});
			}

			await coreService.refreshWorktrees();
			return {success: true};
		});

		// --- Sessions ---
		this.app.get('/api/sessions', async () => {
			const ptySessions = globalSessionOrchestrator.getAllActiveSessions().map(s => ({
				...toApiSessionPayload(s),
				type: 'pty' as const,
			}));
			const sdkSessions = sdkSessionManager.getAllSessions()
				.filter(s => s.state !== 'closed')
				.map(s => ({
					id: s.id,
					name: s.name,
					path: s.worktreePath,
					state: s.state === 'connecting' ? 'busy' as const : s.state === 'closed' ? 'idle' as const : s.state as SessionState,
					createdAt: Math.floor(s.createdAt.getTime() / 1000),
					isActive: s.state !== 'closed' && s.state !== 'error',
					agentId: s.agentId,
					type: 'sdk' as const,
					pid: 0,
					autoApprovalFailed: false,
					autoApprovalReason: undefined,
				}));
			return [...ptySessions, ...sdkSessions];
		});

		this.app.get<{
			Querystring: {
				projectPath?: string;
				worktreePath?: string;
				taskId?: string;
				agentType?: string;
				search?: string;
				limit?: string;
				offset?: string;
				dateFrom?: string;
				dateTo?: string;
			};
		}>('/api/conversations', async request => {
			const {
				projectPath,
				worktreePath,
				taskId,
				agentType,
				search,
				dateFrom,
				dateTo,
			} = request.query;
			const limit = Math.max(
				1,
				Math.min(500, Number.parseInt(request.query.limit || '50', 10) || 50),
			);
			const offset = Math.max(
				0,
				Number.parseInt(request.query.offset || '0', 10) || 0,
			);

			const selectedProjectPath = coreService.getSelectedProject()?.path;
			const effectiveProjectPath = projectPath || selectedProjectPath;
			const parsedDateFrom =
				typeof dateFrom === 'string'
					? Number.parseInt(dateFrom, 10)
					: undefined;
			const parsedDateTo =
				typeof dateTo === 'string' ? Number.parseInt(dateTo, 10) : undefined;

			const filters = {
				projectPath: effectiveProjectPath,
				worktreePath,
				tdTaskId: taskId,
				agentType,
				search,
				limit,
				offset,
				dateFrom: Number.isFinite(parsedDateFrom) ? parsedDateFrom : undefined,
				dateTo: Number.isFinite(parsedDateTo) ? parsedDateTo : undefined,
			};

			let [storedSessions, total] = await Promise.all([
				Promise.resolve(sessionStore.querySessions(filters)),
				Promise.resolve(sessionStore.countSessions(filters)),
			]);

			if (search?.trim()) {
				const hydrationCandidates = sessionStore
					.querySessions({
						...filters,
						search: undefined,
						limit: 500,
						offset: 0,
					})
					.filter(
						session =>
							!session.contentPreview &&
							!!session.agentSessionPath &&
							existsSync(session.agentSessionPath),
					);
				if (hydrationCandidates.length > 0) {
					await Promise.all(
						hydrationCandidates.map(session =>
							sessionStore.hydrateSessionContentPreview(session.id),
						),
					);
					[storedSessions, total] = await Promise.all([
						Promise.resolve(sessionStore.querySessions(filters)),
						Promise.resolve(sessionStore.countSessions(filters)),
					]);
				}
			}

			const missingPreviews = storedSessions.filter(
				session =>
					!session.contentPreview &&
					!!session.agentSessionPath &&
					existsSync(session.agentSessionPath),
			);
			if (missingPreviews.length > 0) {
				await Promise.all(
					missingPreviews.map(session =>
						sessionStore.hydrateSessionContentPreview(session.id),
					),
				);
				storedSessions = sessionStore.querySessions(filters);
			}

			const activeSessions = new Map(
				coreService.sessionManager
					.getAllSessions()
					.map(session => [session.id, session] as const),
			);

			const sessions = storedSessions.map(session => {
				const liveSession = activeSessions.get(session.id);
				const missingSessionFile =
					!!session.agentSessionPath && !existsSync(session.agentSessionPath);
				return {
					...session,
					isActive: !!liveSession,
					state: liveSession?.stateMutex.getSnapshot().state || 'idle',
					missingSessionFile,
				};
			});

			return {
				sessions,
				total,
				limit,
				offset,
			};
		});

		this.app.get<{
			Querystring: {
				tdSessionId?: string;
				taskId?: string;
				projectPath?: string;
			};
		}>('/api/conversations/resolve-linked-session', async (request, reply) => {
			const tdSessionId = request.query.tdSessionId?.trim();
			if (!tdSessionId) {
				return reply.code(400).send({error: 'tdSessionId is required'});
			}

			const directSession = sessionStore.getSessionById(tdSessionId);
			if (directSession) {
				return {
					sessionId: directSession.id,
				};
			}

			const selectedProjectPath = coreService.getSelectedProject()?.path;
			const effectiveProjectPath =
				request.query.projectPath || selectedProjectPath;
			const resolutionAttempts = [
				{
					tdSessionId,
					tdTaskId: request.query.taskId,
					projectPath: effectiveProjectPath,
				},
				{tdSessionId, tdTaskId: request.query.taskId},
				{tdSessionId, projectPath: effectiveProjectPath},
				{tdSessionId},
			];
			let resolved = null;
			for (const attempt of resolutionAttempts) {
				resolved = sessionStore.getLatestByTdSessionId(attempt);
				if (resolved) {
					break;
				}
			}

			return {
				sessionId: resolved?.id || null,
			};
		});

		const resolveConversationSession = (sessionId: string) => {
			const directSession = sessionStore.getSessionById(sessionId);
			if (directSession) {
				return directSession;
			}
			if (sessionId.startsWith('ses_')) {
				return sessionStore.getLatestByTdSessionId({tdSessionId: sessionId});
			}
			return null;
		};

		this.app.get<{
			Params: {sessionId: string};
		}>('/api/conversations/:sessionId', async (request, reply) => {
			const {sessionId} = request.params;
			const storedSession = resolveConversationSession(sessionId);
			if (!storedSession) {
				return reply.code(404).send({error: 'Session not found'});
			}

			if (
				!storedSession.contentPreview &&
				storedSession.agentSessionPath &&
				existsSync(storedSession.agentSessionPath)
			) {
				await sessionStore.hydrateSessionContentPreview(storedSession.id);
			}

			const refreshed =
				sessionStore.getSessionById(storedSession.id) || storedSession;
			const liveSession = globalSessionOrchestrator.findSession(
				storedSession.id,
			)?.session;
			const missingSessionFile =
				!!refreshed.agentSessionPath && !existsSync(refreshed.agentSessionPath);

			return {
				session: {
					...refreshed,
					isActive: !!liveSession,
					state: liveSession?.stateMutex.getSnapshot().state || 'idle',
					missingSessionFile,
				},
			};
		});

		this.app.get<{
			Params: {sessionId: string};
			Querystring: {limit?: string; offset?: string};
		}>('/api/conversations/:sessionId/messages', async (request, reply) => {
			const {sessionId} = request.params;
			const limit = Math.max(
				1,
				Math.min(
					1000,
					Number.parseInt(request.query.limit || '200', 10) || 200,
				),
			);
			const offset = Math.max(
				0,
				Number.parseInt(request.query.offset || '0', 10) || 0,
			);

			const storedSession = resolveConversationSession(sessionId);
			if (!storedSession) {
				return reply.code(404).send({error: 'Session not found'});
			}

			if (!storedSession.agentSessionPath) {
				return {
					sessionId: storedSession.id,
					session: storedSession,
					metadata: {},
					messages: [],
					total: 0,
					limit,
					offset,
					missingSessionFile: false,
					subAgentSessions: [],
				};
			}

			if (!existsSync(storedSession.agentSessionPath)) {
				return {
					sessionId: storedSession.id,
					session: storedSession,
					metadata: {},
					messages: [],
					total: 0,
					limit,
					offset,
					missingSessionFile: true,
					subAgentSessions: [],
				};
			}

			const adapter =
				adapterRegistry.getByAgentType(storedSession.agentType) ||
				(() => {
					const configuredAgent = configurationManager.getAgentById(
						storedSession.agentProfileId,
					);
					return configuredAgent
						? adapterRegistry.createGeneric(configuredAgent)
						: null;
				})();
			if (!adapter) {
				return {
					sessionId: storedSession.id,
					session: storedSession,
					metadata: {},
					messages: [],
					total: 0,
					limit,
					offset,
					missingSessionFile: false,
					subAgentSessions: [],
					error: `No adapter registered for ${storedSession.agentType}`,
				};
			}

			try {
				const [metadata, parsedMessages, subAgentSessions] = await Promise.all([
					adapter.extractMetadata(storedSession.agentSessionPath),
					adapter.parseMessages(storedSession.agentSessionPath),
					adapter.findSubAgentSessions
						? adapter.findSubAgentSessions(storedSession.agentSessionPath)
						: Promise.resolve([]),
				]);
				const total = parsedMessages.length;
				const messages = parsedMessages.slice(offset, offset + limit);

				return {
					sessionId: storedSession.id,
					session: storedSession,
					metadata,
					messages,
					total,
					limit,
					offset,
					missingSessionFile: false,
					subAgentSessions,
				};
			} catch (error) {
				logger.warn(
					`API: Failed to parse conversation messages for ${sessionId}: ${String(error)}`,
				);
				return reply
					.code(500)
					.send({error: 'Failed to parse session messages'});
			}
		});

		// Legacy /api/session/create endpoint removed - use /api/session/create-with-agent instead

		this.app.post<{Body: {id: string}}>(
			'/api/session/stop',
			async (request, reply) => {
				const {id} = request.body;
				logger.info(`API: Stopping session ${id}`);

				const hit = globalSessionOrchestrator.findSession(id);
				if (!hit) {
					return reply.code(404).send({error: 'Session not found'});
				}

				hit.manager.destroySession(id);
				return {success: true};
			},
		);

		this.app.post<{Body: {id: string}}>(
			'/api/session/restart',
			async (request, reply) => {
				const {id} = request.body;
				logger.info(`API: Restarting session ${id}`);

				const liveHit = globalSessionOrchestrator.findSession(id);
				const liveSession = liveHit?.session;
				if (liveSession) {
					this.persistSessionMetadataIfMissing(liveSession);
				}

				const storedSession = sessionStore.getSessionById(id);
				if (!liveSession && !storedSession) {
					return reply.code(404).send({error: 'Session not found'});
				}

				if (liveHit) {
					liveHit.manager.destroySession(id);
				}

				const restartRecord = storedSession || sessionStore.getSessionById(id);
				if (!restartRecord) {
					return reply
						.code(409)
						.send({error: 'Session metadata unavailable for restart'});
				}

				const outcome = await this.recoverSessionFromRecord(restartRecord, {
					injectFallbackPrompt: true,
					markEndedOnFailure: false,
				});
				if (!outcome.ok) {
					return reply
						.code(500)
						.send({error: outcome.error || 'Failed to restart session'});
				}

				sessionStore.markSessionResumed(id);
				return {
					success: true,
					id,
					recoveryMode: outcome.recoveryMode,
					notice: outcome.notice,
				};
			},
		);

		this.app.post<{Body: {id: string; isActive: boolean}}>(
			'/api/session/set-active',
			async (request, reply) => {
				const {id, isActive} = request.body;
				const hit = globalSessionOrchestrator.findSession(id);
				if (!hit) {
					return reply.code(404).send({error: 'Session not found'});
				}

				hit.manager.setSessionActive(id, isActive);
				return {success: true};
			},
		);

		this.app.post<{Body: {id: string; reason?: string}}>(
			'/api/session/cancel-auto-approval',
			async (request, reply) => {
				const {id, reason} = request.body;
				const hit = globalSessionOrchestrator.findSession(id);
				if (!hit) {
					return reply.code(404).send({error: 'Session not found'});
				}

				hit.manager.cancelAutoApproval(id, reason);
				return {success: true};
			},
		);

		this.app.post<{Body: {id: string; name?: string}}>(
			'/api/session/rename',
			async (request, reply) => {
				const {id, name} = request.body;
				logger.info(`API: Renaming session ${id}`);

				const hit = globalSessionOrchestrator.findSession(id);
				if (!hit) {
					return reply.code(404).send({error: 'Session not found'});
				}

				hit.manager.renameSession(id, name);
				try {
					sessionStore.updateSessionName(id, name);
				} catch (error) {
					logger.warn(
						`API: Failed to update session name in store for ${id}: ${String(error)}`,
					);
				}
				return {success: true};
			},
		);

		// --- Configuration ---
		// Legacy /api/presets endpoint removed - use /api/agents instead

		this.app.get('/api/config', async () => {
			return configurationManager.getConfiguration();
		});

		this.app.post<{Body: Partial<ConfigurationData>}>(
			'/api/config',
			async (request, reply) => {
				const partialConfig = request.body;

				// Merge with existing config to preserve fields not sent by frontend
				// (e.g., agents, commandPresets, shortcuts are managed separately)
				const existingConfig = configurationManager.getConfiguration();
				const mergedConfig: ConfigurationData = {
					...existingConfig,
					...partialConfig,
					// Preserve these sections that are managed via separate endpoints
					agents: existingConfig.agents,
					commandPresets: existingConfig.commandPresets,
					shortcuts: existingConfig.shortcuts,
					command: existingConfig.command,
					port: existingConfig.port,
				};

				// Validate
				const validation = configurationManager.validateConfig(mergedConfig);
				if (validation._tag === 'Left') {
					const error = validation.left as ValidationError;
					return reply
						.code(400)
						.send({error: `${error.field}: ${error.constraint}`});
				}

				// Save
				const effect = configurationManager.saveConfigEffect(mergedConfig);
				const result = await Effect.runPromise(Effect.either(effect));

				if (result._tag === 'Left') {
					return reply.code(500).send({error: result.left.message});
				}

				return {success: true};
			},
		);

		// --- Agents ---
		this.app.get<{Querystring: {includeDisabled?: string}}>(
			'/api/agents',
			async request => {
				const includeDisabled =
					request.query.includeDisabled === 'true' ||
					request.query.includeDisabled === '1';
				if (includeDisabled) {
					return configurationManager.getAgentsConfig();
				}

				const config = configurationManager.getAgentsConfig();
				return {
					...config,
					agents: configurationManager.getEnabledAgents(),
				};
			},
		);

		this.app.get<{Params: {id: string}}>(
			'/api/agents/:id',
			async (request, reply) => {
				const agent = configurationManager.getAgentById(request.params.id);
				if (!agent) {
					return reply.code(404).send({error: 'Agent not found'});
				}
				return agent;
			},
		);

		this.app.put<{
			Params: {id: string};
			Body: import('../types/index.js').AgentConfig;
		}>('/api/agents/:id', async (request, reply) => {
			const {id} = request.params;
			const agent = request.body;

			// Ensure ID matches
			if (agent.id !== id) {
				return reply.code(400).send({error: 'Agent ID mismatch'});
			}

			const saved = configurationManager.saveAgent(agent);
			if (!saved.success) {
				return reply
					.code(400)
					.send({error: saved.error || 'Failed to save agent'});
			}
			logger.info(`API: Saved agent ${id}`);
			return {
				success: true,
				agent: saved.agent,
				defaultChangedFrom: saved.defaultChangedFrom,
				defaultChangedTo: saved.defaultChangedTo,
			};
		});

		this.app.post<{Body: import('../types/index.js').AgentConfig}>(
			'/api/agents',
			async (request, reply) => {
				const agent = request.body;

				// Check if agent with this ID already exists
				if (configurationManager.getAgentById(agent.id)) {
					return reply
						.code(409)
						.send({error: 'Agent with this ID already exists'});
				}

				const saved = configurationManager.saveAgent(agent);
				if (!saved.success) {
					return reply
						.code(400)
						.send({error: saved.error || 'Failed to create agent'});
				}
				logger.info(`API: Created agent ${agent.id}`);
				return {
					success: true,
					agent: saved.agent,
					defaultChangedFrom: saved.defaultChangedFrom,
					defaultChangedTo: saved.defaultChangedTo,
				};
			},
		);

		this.app.delete<{Params: {id: string}}>(
			'/api/agents/:id',
			async (request, reply) => {
				const {id} = request.params;
				const deleted = configurationManager.deleteAgent(id);

				if (!deleted) {
					return reply
						.code(400)
						.send({error: 'Cannot delete agent (last agent or default)'});
				}

				logger.info(`API: Deleted agent ${id}`);
				return {success: true};
			},
		);

		this.app.post<{Body: {id: string}}>(
			'/api/agents/default',
			async (request, reply) => {
				const {id} = request.body;
				const success = configurationManager.setDefaultAgent(id);

				if (!success) {
					return reply
						.code(404)
						.send({error: 'Agent not found or agent is disabled'});
				}

				logger.info(`API: Set default agent to ${id}`);
				return {success: true};
			},
		);

		// Create session with agent (new endpoint)
		this.app.post<{
			Body: {
				path: string;
				agentId: string;
				options?: Record<string, boolean | string>;
				sessionName?: string;
				taskListName?: string;
				tdTaskId?: string;
				promptTemplate?: string;
				intent?: 'work' | 'review' | 'fix' | 'manual';
			};
		}>('/api/session/create-with-agent', async (request, reply) => {
			const {
				path: worktreePath,
				agentId,
				options = {},
				sessionName,
				taskListName,
				tdTaskId,
				promptTemplate,
				intent,
			} = request.body;
			const normalizedTdTaskId = tdTaskId?.trim();
			const resolvedIntent = resolveSessionIntent(intent);
			if (normalizedTdTaskId && !isValidTdTaskId(normalizedTdTaskId)) {
				return reply.code(400).send({error: 'Invalid tdTaskId format'});
			}
			logger.info(
				`API: Creating session "${sessionName || 'unnamed'}" for ${worktreePath} with agent: ${agentId}`,
			);

			const agent = configurationManager.getAgentById(agentId);
			if (!agent) {
				logger.error(`API: Agent not found: ${agentId}`);
				return reply.code(404).send({error: 'Agent not found'});
			}
			if (agent.enabled === false) {
				return reply
					.code(400)
					.send({error: `Agent "${agent.name}" is disabled`});
			}

			logger.info(
				`API: Found agent "${agent.name}" (id=${agent.id}, command=${agent.command})`,
			);
			const normalizedPromptArg = agent.promptArg?.trim();

			// Validate options
			const validationErrors = configurationManager.validateAgentOptions(
				agent,
				options,
			);
			if (validationErrors.length > 0) {
				return reply.code(400).send({error: validationErrors.join('; ')});
			}

			// Build args
			const args = configurationManager.buildAgentArgs(agent, options);
			logger.info(`API: Built args for ${agent.id}: [${args.join(', ')}]`);

			// Resolve command ($SHELL for terminal)
			let command = agent.command;
			if (command === '$SHELL') {
				command = getDefaultShell();
			}
			logger.info(`API: Spawning command: ${command} ${args.join(' ')}`);

			// Build extra env for Claude task list and td integration
			const extraEnv: Record<string, string> = {};
			const isClaudeAgent =
				agentId === 'claude' ||
				agent.command === 'claude' ||
				agent.detectionStrategy === 'claude';
			const projects = projectManager.getProjects();
			const matchedProject = projects.find(
				(p: {path: string}) =>
					worktreePath.startsWith(p.path) ||
					worktreePath.includes(`/.worktrees/${p.path.split('/').pop()}/`),
			);
			const linkedProjectPath =
				matchedProject?.path ||
				resolveGitField(worktreePath, ['rev-parse', '--show-toplevel']);
			const projConfig = matchedProject
				? loadProjectConfig(matchedProject.path)
				: null;
			const globalTdConfig = configurationManager.getTdConfig();
			const effectiveTdConfig = resolveEffectiveTdStartupConfig(
				projConfig,
				globalTdConfig,
			);
			let startupPromptToInject: string | undefined = undefined;
			let linkedTdSessionId: string | undefined;

			if (taskListName && isClaudeAgent) {
				extraEnv['CLAUDE_TASK_LIST'] = taskListName;
				logger.info(`API: Setting CLAUDE_TASK_LIST=${taskListName}`);
			}

			// TD startup context and prompt injection for task-linked sessions
			if (normalizedTdTaskId && effectiveTdConfig.enabled) {
				let shouldAutoStartTdTask = false;
				let renderedPromptTemplate: string | null = null;
				if (tdService.isAvailable()) {
					let tdSessionId: string | null = null;
					if (resolvedIntent === 'work' || resolvedIntent === 'fix') {
						tdSessionId = sessionStore.getOriginalWorkTdSessionId({
							tdTaskId: normalizedTdTaskId,
							projectPath: linkedProjectPath,
						});
					}
					if (!tdSessionId) {
						tdSessionId = `ses_${randomUUID().slice(0, 6)}`;
					}
					linkedTdSessionId = tdSessionId;
					extraEnv['TD_SESSION_ID'] = tdSessionId;
					extraEnv['TD_TASK_ID'] = normalizedTdTaskId;
					logger.info(
						`API: Setting TD_SESSION_ID=${tdSessionId}, TD_TASK_ID=${normalizedTdTaskId}`,
					);
					shouldAutoStartTdTask = effectiveTdConfig.autoStart;
				}

				if (effectiveTdConfig.injectTaskContext) {
					try {
						const promptTemplates = loadPromptTemplatesByScope(
							matchedProject?.path || '',
							matchedProject ? 'effective' : 'global',
						);

						// Fetch task detail first to check for rejection context
						const tdState = tdService.resolveProjectState(worktreePath);
						if (!tdState.initialized || !tdState.dbPath) {
							return reply.code(400).send({
								error:
									'TD project state is not initialized. Initialize td before linking sessions to tasks.',
							});
						}

						const reader = new TdReader(tdState.dbPath);
						let taskDetail: TdIssueWithChildren | null;
						try {
							taskDetail = reader.getIssueWithDetails(normalizedTdTaskId);
						} finally {
							reader.close();
						}

						if (!taskDetail) {
							return reply.code(404).send({
								error: `TD task ${normalizedTdTaskId} not found`,
							});
						}

						const explicitPromptTemplate = promptTemplate?.trim();
						let selectedTemplate: PromptTemplate | null = null;

						if (explicitPromptTemplate) {
							selectedTemplate = findPromptTemplateByName(
								promptTemplates,
								explicitPromptTemplate,
							);
							if (!selectedTemplate) {
								return reply.code(400).send({
									error: `Prompt template "${explicitPromptTemplate}" not found`,
								});
							}
						} else {
							// Auto-select "Fix Rejected Work" only for work intent on rejected tasks
							const isRejectedInProgress =
								resolvedIntent === 'work' &&
								taskDetail.status === 'in_progress' &&
								taskDetail.rejectionReason !== null;

							if (isRejectedInProgress) {
								const fixRejectedTemplate = findPromptTemplateByName(
									promptTemplates,
									'Fix Rejected Work',
								);
								if (fixRejectedTemplate) {
									selectedTemplate = fixRejectedTemplate;
									logger.info(
										`API: Auto-selected "Fix Rejected Work" prompt for rejected task ${normalizedTdTaskId}`,
									);
								} else {
									// Fallback to 'Begin Work on Task' when Fix template missing
									const beginTemplate = findPromptTemplateByName(
										promptTemplates,
										'Begin Work on Task',
									);
									if (beginTemplate) {
										selectedTemplate = beginTemplate;
										logger.info(
											`API: Fix Rejected Work template not found, using Begin Work on Task for ${normalizedTdTaskId}`,
										);
									}
								}
							}

							// Fall back to configured default if no auto-selection
							if (!selectedTemplate) {
								const projectDefaultPrompt =
									projConfig?.td?.defaultPrompt?.trim();
								const globalDefaultPrompt =
									globalTdConfig.defaultPrompt?.trim();
								selectedTemplate =
									(projectDefaultPrompt &&
										findPromptTemplateByName(
											promptTemplates,
											projectDefaultPrompt,
										)) ||
									(globalDefaultPrompt &&
										findPromptTemplateByName(
											promptTemplates,
											globalDefaultPrompt,
										)) ||
									null;
							}

							if (!selectedTemplate) {
								if (promptTemplates.length > 0) {
									selectedTemplate = promptTemplates[0]!;
								} else {
									return reply.code(400).send({
										error:
											'No default TD prompt is configured. Set one in Settings > TD Integration.',
									});
								}
							}
						}

						if (!selectedTemplate.content?.trim()) {
							return reply.code(400).send({
								error: `Prompt template "${selectedTemplate.name}" has empty content`,
							});
						}

						renderedPromptTemplate = renderTaskPromptTemplate(
							selectedTemplate.content,
							taskDetail,
						);
					} catch (err) {
						logger.warn(`API: Failed to prepare TD startup prompt: ${err}`);
						return reply
							.code(500)
							.send({error: 'Failed to prepare TD startup prompt'});
					}
				} else {
					logger.info('API: TD task-context injection disabled by config');
				}

				if (
					effectiveTdConfig.injectTdUsage ||
					effectiveTdConfig.injectTaskContext
				) {
					startupPromptToInject = buildTdStartupPrompt({
						taskId: normalizedTdTaskId,
						renderedPromptTemplate,
						injectTdUsage: effectiveTdConfig.injectTdUsage,
					});
				}

				// Auto-start only after all TD prompt/task validations succeeded.
				if (shouldAutoStartTdTask && linkedTdSessionId) {
					try {
						execFileSync(
							'td',
							[
								'start',
								normalizedTdTaskId,
								'--session',
								linkedTdSessionId,
								'-w',
								worktreePath,
							],
							{
								encoding: 'utf-8',
								timeout: 5000,
							},
						);
						logger.info(`API: Auto-started td task ${normalizedTdTaskId}`);
					} catch (startErr) {
						// Non-fatal: task might already be in_progress
						logger.warn(
							`API: td start failed (may already be started): ${startErr}`,
						);
					}
				} else if (effectiveTdConfig.autoStart) {
					logger.info('API: td auto-start skipped (td unavailable)');
				} else {
					logger.info('API: td auto-start disabled by config');
				}
			}

			// Use CLI arg delivery by default, fall back to PTY write only when startup
			// prompt cannot be passed through the command line.
			const startupPromptDeliveredViaCli = !!(
				startupPromptToInject && normalizedPromptArg?.toLowerCase() !== 'none'
			);

			// Create session with resolved command and args
			const effect = coreService.sessionManager.createSessionWithAgentEffect(
				worktreePath,
				command,
				args,
				agent.detectionStrategy,
				sessionName,
				agentId,
				Object.keys(extraEnv).length > 0 ? extraEnv : undefined,
				agent.kind,
				{
					initialPrompt: startupPromptDeliveredViaCli
						? startupPromptToInject
						: undefined,
					promptArg: normalizedPromptArg,
					prependCwd: agent.prependCwd,
				},
			);
			const result = await Effect.runPromise(Effect.either(effect));

			if (result._tag === 'Left') {
				return reply.code(500).send({error: result.left.message});
			}

			// Session created successfully - store task list name to project metadata
			if (taskListName && isClaudeAgent) {
				// Find the project that contains this worktree path
				const projects = projectManager.getProjects();
				for (const project of projects) {
					if (worktreePath.startsWith(project.path)) {
						projectManager.instance.addTaskListName(project.path, taskListName);
						logger.info(
							`API: Stored task list name "${taskListName}" for project ${project.name}`,
						);
						break;
					}
				}
			}

			const session = result.right;
			coreService.sessionManager.setSessionActive(session.id, true);

			const createdAt = Math.floor(Date.now() / 1000);
			const branchName = resolveGitField(worktreePath, [
				'branch',
				'--show-current',
			]);
			const projectPath = linkedProjectPath;
			const adapterForAgent =
				adapterRegistry.getById(agent.id) ||
				adapterRegistry.getByAgentType(inferAgentType(agent));
			const agentType = adapterForAgent?.id || inferAgentType(agent);

			try {
				sessionStore.createSessionRecord({
					id: session.id,
					agentProfileId: agent.id,
					agentProfileName: agent.name,
					agentType,
					agentOptions: options,
					worktreePath,
					branchName,
					projectPath,
					tdTaskId: normalizedTdTaskId,
					tdSessionId: linkedTdSessionId,
					sessionName: session.name,
					intent: resolvedIntent,
					createdAt,
				});

				sessionStore.scheduleAgentSessionDiscovery({
					sessionId: session.id,
					agentType,
					worktreePath,
					createdAt,
				});
			} catch (error) {
				logger.warn(
					`API: Failed to persist session metadata for ${session.id}: ${String(error)}`,
				);
			}

			// PTY injection is only needed when the prompt could NOT be passed via CLI arg.
			// If initialPrompt was passed to createSessionWithAgentEffect (CLI path), the
			// agent already received the prompt at process start — PTY injection would
			// double-post it (e.g. Codex starts working but prompt also appears in input field).
			if (
				startupPromptToInject &&
				agent.kind !== 'terminal' &&
				!startupPromptDeliveredViaCli
			) {
				this.queueTdPromptInjection(
					session.id,
					startupPromptToInject,
					normalizedTdTaskId,
				);
				this.injectPendingTdPromptIfReady(session);
			}

			return {
				success: true,
				id: session.id,
				name: session.name,
				agentId: session.agentId,
			};
		});

		// --- TD Integration ---

		// TD availability check
		this.app.get('/api/td/status', async () => {
			const availability = tdService.checkAvailability();
			const {projectConfig, projectState} = resolveSelectedProjectTdContext();
			return {
				availability,
				projectState,
				projectConfig: projectConfig?.td || null,
			};
		});

		// Initialize td in current project
		this.app.post('/api/td/init', async (request, reply) => {
			const {project, projectConfig, projectState} =
				resolveSelectedProjectTdContext();
			if (!project || !projectState) {
				return reply.code(400).send({error: 'No project selected'});
			}

			const availability = tdService.checkAvailability();
			if (!availability.binaryAvailable) {
				return reply.code(400).send({error: 'TD binary not available'});
			}

			if (projectState.initialized) {
				return {
					success: true,
					alreadyInitialized: true,
					projectState,
					projectConfig: projectConfig?.td || null,
				};
			}

			try {
				execFileSync('td', ['init'], {
					cwd: project.path,
					encoding: 'utf-8',
					timeout: 10000,
				});
			} catch (error) {
				logger.warn(`API: td init failed for ${project.path}: ${error}`);
				return reply
					.code(500)
					.send({error: `Failed to initialize td: ${error}`});
			}

			const refreshedRawState = tdService.resolveProjectState(project.path);
			const refreshedState =
				projectConfig?.td?.enabled === false
					? {...refreshedRawState, enabled: false}
					: refreshedRawState;

			return {
				success: true,
				alreadyInitialized: false,
				projectState: refreshedState,
				projectConfig: projectConfig?.td || null,
			};
		});

		// TD issues list (for current project)
		this.app.get<{
			Querystring: {status?: string; type?: string; parentId?: string};
		}>('/api/td/issues', async (request, reply) => {
			const {project, projectState} = resolveSelectedProjectTdContext();
			if (!project || !projectState) {
				return reply.code(400).send({error: 'No project selected'});
			}

			if (!projectState.enabled || !projectState.dbPath) {
				return reply
					.code(404)
					.send({error: 'TD not available for this project'});
			}

			const reader = new TdReader(projectState.dbPath);
			try {
				const issues = reader.listIssues({
					status: request.query.status,
					type: request.query.type,
					parentId: request.query.parentId,
				});
				return {issues};
			} finally {
				reader.close();
			}
		});

		// TD single issue with details
		this.app.get<{Params: {id: string}}>(
			'/api/td/issues/:id',
			async (request, reply) => {
				const {project, projectState} = resolveSelectedProjectTdContext();
				if (!project || !projectState) {
					return reply.code(400).send({error: 'No project selected'});
				}

				if (!projectState.enabled || !projectState.dbPath) {
					return reply
						.code(404)
						.send({error: 'TD not available for this project'});
				}

				const reader = new TdReader(projectState.dbPath);
				try {
					const issue = reader.getIssueWithDetails(request.params.id);
					if (!issue) {
						return reply.code(404).send({error: 'Issue not found'});
					}
					return {issue};
				} finally {
					reader.close();
				}
			},
		);

		// TD board view (grouped by status)
		this.app.get('/api/td/board', async (request, reply) => {
			const {project, projectState} = resolveSelectedProjectTdContext();
			if (!project || !projectState) {
				return reply.code(400).send({error: 'No project selected'});
			}

			if (!projectState.enabled || !projectState.dbPath) {
				return reply
					.code(404)
					.send({error: 'TD not available for this project'});
			}

			const reader = new TdReader(projectState.dbPath);
			try {
				return {board: reader.getBoard()};
			} finally {
				reader.close();
			}
		});

		// TD search issues
		this.app.get<{
			Querystring: {q: string};
		}>('/api/td/search', async (request, reply) => {
			const {q} = request.query;
			if (!q) {
				return reply.code(400).send({error: 'Search query required'});
			}

			const {project, projectState} = resolveSelectedProjectTdContext();
			if (!project || !projectState) {
				return reply.code(400).send({error: 'No project selected'});
			}

			if (!projectState.enabled || !projectState.dbPath) {
				return reply
					.code(404)
					.send({error: 'TD not available for this project'});
			}

			const reader = new TdReader(projectState.dbPath);
			try {
				return {issues: reader.searchIssues(q)};
			} finally {
				reader.close();
			}
		});

		// Prompt templates by scope (project/global/effective/all)
		this.app.get<{
			Querystring: {scope?: PromptScope};
		}>('/api/td/prompts', async (request, reply) => {
			const scope = (request.query.scope || 'project') as PromptScope;
			if (!['project', 'global', 'effective', 'all'].includes(scope)) {
				return reply.code(400).send({error: 'Invalid prompt scope'});
			}

			if (scope === 'global') {
				const templates = loadPromptTemplatesByScope('', 'global');
				return {
					templates: templates.map(t => ({
						name: t.name,
						path: t.path,
						source: t.source,
						effective: t.effective,
						overridden: t.overridden,
						overridesGlobal: t.overridesGlobal,
					})),
				};
			}

			const {project} = resolveSelectedProjectTdContext();
			if (!project) {
				return reply.code(400).send({error: 'No project selected'});
			}

			const templates = loadPromptTemplatesByScope(project.path, scope);
			return {
				templates: templates.map(t => ({
					name: t.name,
					path: t.path,
					source: t.source,
					effective: t.effective,
					overridden: t.overridden,
					overridesGlobal: t.overridesGlobal,
				})),
			};
		});

		// Get specific prompt template content
		this.app.get<{
			Params: {name: string};
			Querystring: {scope?: 'project' | 'global' | 'effective'};
		}>('/api/td/prompts/:name', async (request, reply) => {
			const scope = request.query.scope || 'project';
			if (!['project', 'global', 'effective'].includes(scope)) {
				return reply.code(400).send({error: 'Invalid prompt scope'});
			}

			if (scope === 'global') {
				const template = loadPromptTemplateByScope(
					'',
					'global',
					request.params.name,
				);
				if (!template) {
					return reply.code(404).send({error: 'Template not found'});
				}
				return {template};
			}

			const {project} = resolveSelectedProjectTdContext();
			if (!project) {
				return reply.code(400).send({error: 'No project selected'});
			}

			const template = loadPromptTemplateByScope(
				project.path,
				scope,
				request.params.name,
			);
			if (!template) {
				return reply.code(404).send({error: 'Template not found'});
			}

			return {template};
		});

		// Upsert prompt template in selected scope
		this.app.post<{
			Body: {
				scope?: 'project' | 'global';
				name: string;
				content: string;
			};
		}>('/api/td/prompts', async (request, reply) => {
			const scope = request.body.scope || 'project';
			if (!['project', 'global'].includes(scope)) {
				return reply.code(400).send({error: 'Invalid prompt scope'});
			}

			if (!request.body.name || typeof request.body.name !== 'string') {
				return reply.code(400).send({error: 'Prompt name is required'});
			}

			if (typeof request.body.content !== 'string') {
				return reply.code(400).send({error: 'Prompt content is required'});
			}

			let projectPath = '';
			if (scope === 'project') {
				const {project} = resolveSelectedProjectTdContext();
				if (!project) {
					return reply.code(400).send({error: 'No project selected'});
				}
				projectPath = project.path;
			}

			try {
				const template = savePromptTemplateByScope(
					projectPath,
					scope,
					request.body.name,
					request.body.content,
				);
				return {success: true, template};
			} catch (error) {
				return reply
					.code(400)
					.send({error: `Failed to save prompt template: ${error}`});
			}
		});

		// Delete prompt template from selected scope
		this.app.delete<{
			Params: {name: string};
			Querystring: {scope?: 'project' | 'global'};
		}>('/api/td/prompts/:name', async (request, reply) => {
			const scope = request.query.scope || 'project';
			if (!['project', 'global'].includes(scope)) {
				return reply.code(400).send({error: 'Invalid prompt scope'});
			}

			let projectPath = '';
			if (scope === 'project') {
				const {project} = resolveSelectedProjectTdContext();
				if (!project) {
					return reply.code(400).send({error: 'No project selected'});
				}
				projectPath = project.path;
			}

			const deleted = deletePromptTemplateByScope(
				projectPath,
				scope,
				request.params.name,
			);
			if (!deleted) {
				return reply.code(404).send({error: 'Template not found'});
			}

			return {success: true};
		});

		// Submit task for review
		this.app.post<{Params: {id: string}}>(
			'/api/td/issues/:id/review',
			async (request, reply) => {
				const {id} = request.params;
				const {project} = resolveSelectedProjectTdContext();
				if (!project) {
					return reply.code(400).send({error: 'No project selected'});
				}
				if (!tdService.isAvailable()) {
					return reply.code(400).send({error: 'TD not available'});
				}

				try {
					execFileSync('td', ['review', id], {
						encoding: 'utf-8',
						timeout: 5000,
						cwd: project.path,
					});
					return {success: true, message: `Task ${id} submitted for review`};
				} catch (err) {
					logger.warn(`API: td review failed for ${id}: ${err}`);
					return reply
						.code(500)
						.send({error: `Failed to submit for review: ${err}`});
				}
			},
		);

		// Approve/close a task from review
		this.app.post<{Params: {id: string}}>(
			'/api/td/issues/:id/approve',
			async (request, reply) => {
				const {id} = request.params;
				const {project} = resolveSelectedProjectTdContext();
				if (!project) {
					return reply.code(400).send({error: 'No project selected'});
				}
				if (!tdService.isAvailable()) {
					return reply.code(400).send({error: 'TD not available'});
				}

				try {
					execFileSync('td', ['approve', id], {
						encoding: 'utf-8',
						timeout: 5000,
						cwd: project.path,
					});
					return {success: true, message: `Task ${id} approved and closed`};
				} catch (err) {
					logger.warn(`API: td approve failed for ${id}: ${err}`);
					return reply.code(500).send({error: `Failed to approve: ${err}`});
				}
			},
		);

		// Request changes (reopen from review with optional comment)
		this.app.post<{Params: {id: string}; Body: {comment?: string}}>(
			'/api/td/issues/:id/request-changes',
			async (request, reply) => {
				const {id} = request.params;
				const {project} = resolveSelectedProjectTdContext();
				if (!project) {
					return reply.code(400).send({error: 'No project selected'});
				}
				if (!tdService.isAvailable()) {
					return reply.code(400).send({error: 'TD not available'});
				}

				try {
					// Add comment first if provided
					const comment = (request.body as {comment?: string})?.comment;
					if (comment?.trim()) {
						execFileSync('td', ['comment', id, comment.trim()], {
							encoding: 'utf-8',
							timeout: 5000,
							cwd: project.path,
						});
					}
					// Reject the task (moves from in_review back to in_progress)
					execFileSync(
						'td',
						['reject', id, '--reason', 'Changes requested via ArgusDev'],
						{
							encoding: 'utf-8',
							timeout: 5000,
							cwd: project.path,
						},
					);
					return {success: true, message: `Task ${id} sent back for changes`};
				} catch (err) {
					logger.warn(`API: td request-changes failed for ${id}: ${err}`);
					return reply
						.code(500)
						.send({error: `Failed to request changes: ${err}`});
				}
			},
		);

		// In-review tasks (for notification polling)
		this.app.get('/api/td/in-review', async (_request, _reply) => {
			const {project, projectState} = resolveSelectedProjectTdContext();
			if (!project || !projectState) {
				return {issues: []};
			}

			if (!projectState.enabled || !projectState.dbPath) {
				return {issues: []};
			}

			const reader = new TdReader(projectState.dbPath);
			try {
				const issues = reader.listIssues({status: 'in_review'});
				return {issues};
			} finally {
				reader.close();
			}
		});

		// --- Task List Names ---
		this.app.get<{
			Querystring: {projectPath: string};
		}>('/api/project/task-list-names', async (request, reply) => {
			const {projectPath} = request.query;

			if (!projectPath) {
				return reply
					.code(400)
					.send({error: 'projectPath query parameter required'});
			}

			const taskListNames =
				projectManager.instance.getTaskListNames(projectPath);
			return {taskListNames};
		});

		this.app.delete<{
			Body: {projectPath: string; taskListName: string};
		}>('/api/project/task-list-names', async (request, reply) => {
			const {projectPath, taskListName} = request.body;

			if (!projectPath || !taskListName) {
				return reply
					.code(400)
					.send({error: 'projectPath and taskListName required'});
			}

			const removed = projectManager.instance.removeTaskListName(
				projectPath,
				taskListName,
			);

			if (!removed) {
				return reply.code(404).send({error: 'Task list name not found'});
			}

			logger.info(
				`API: Removed task list name "${taskListName}" from project ${projectPath}`,
			);
			return {success: true};
		});

		// --- SDK Sessions ---

		this.app.post<{Body: {worktreePath: string; agentId: string; options?: Record<string, boolean | string>; sessionName?: string; initialPrompt?: string}}>(
			'/api/sdk-session/create',
			async (request, reply) => {
				const {worktreePath, agentId, options, sessionName, initialPrompt} = request.body;
				if (!worktreePath || !agentId) {
					return reply.code(400).send({error: 'worktreePath and agentId required'});
				}

				const agent = configurationManager.getAgentById(agentId);
				if (!agent || agent.sessionType !== 'sdk') {
					return reply.code(400).send({error: 'Agent is not an SDK session type'});
				}

				const args = configurationManager.buildAgentArgs(agent, options || {});
				logger.info(`API: Creating SDK session for ${worktreePath} with agent ${agentId}, args: [${args.join(', ')}]`);

				const session = sdkSessionManager.createSession(
					worktreePath,
					args,
					undefined,
					initialPrompt,
					sessionName,
				);

				return {success: true, id: session.id, agentId};
			},
		);

		this.app.post<{Body: {content: string}; Params: {id: string}}>(
			'/api/sdk-session/:id/message',
			async (request, reply) => {
				const sent = sdkSessionManager.sendMessage(request.params.id, request.body.content);
				if (!sent) return reply.code(404).send({error: 'SDK session not found or not writable'});
				return {success: true};
			},
		);

		this.app.post<{Params: {id: string}}>(
			'/api/sdk-session/:id/approve',
			async (request, reply) => {
				const ok = sdkSessionManager.approveToolCall(request.params.id);
				if (!ok) return reply.code(404).send({error: 'No pending approval'});
				return {success: true};
			},
		);

		this.app.post<{Params: {id: string}}>(
			'/api/sdk-session/:id/reject',
			async (request, reply) => {
				const ok = sdkSessionManager.rejectToolCall(request.params.id);
				if (!ok) return reply.code(404).send({error: 'No pending approval'});
				return {success: true};
			},
		);

		this.app.post<{Params: {id: string}}>(
			'/api/sdk-session/:id/stop',
			async (request, reply) => {
				sdkSessionManager.stopSession(request.params.id);
				return {success: true};
			},
		);

		this.app.get<{Params: {id: string}}>(
			'/api/sdk-session/:id/messages',
			async (request, reply) => {
				const session = sdkSessionManager.getSession(request.params.id);
				if (!session) return reply.code(404).send({error: 'SDK session not found'});
				return session.messages;
			},
		);

		// Include SDK sessions in the main sessions listing
		const originalSessionsRoute = this.app.get('/api/sdk-sessions', async () => {
			return sdkSessionManager.getAllSessions().map(s => ({
				id: s.id,
				name: s.name,
				path: s.worktreePath,
				state: s.state === 'connecting' ? 'busy' : s.state === 'closed' ? 'idle' : s.state,
				createdAt: Math.floor(s.createdAt.getTime() / 1000),
				isActive: s.state !== 'closed' && s.state !== 'error',
				agentId: s.agentId,
				type: 'sdk' as const,
				model: s.model,
				usage: s.usage,
			}));
		});
	}

	private setupSocketHandlers() {
		this.app.ready().then(() => {
			this.io = new Server(this.app.server, {
				cors: {
					origin: (origin, cb) => {
						// Allow requests with no origin
						if (!origin) {
							cb(null, true);
							return;
						}
						// Allow localhost and private network origins
						try {
							const url = new URL(origin);
							if (isAllowedHost(url.hostname)) {
								cb(null, true);
							} else {
								cb(new Error('Not allowed by CORS'));
							}
						} catch {
							cb(new Error('Invalid origin'));
						}
					},
					methods: ['GET', 'POST'],
					credentials: true, // Allow cookies
				},
			});

			// Socket.IO authentication middleware
			this.io.use((socket, next) => {
				const configuredAccessToken = configurationManager.getAccessToken();
				const headerTokenRaw = socket.handshake.headers['x-access-token'];
				const headerToken = Array.isArray(headerTokenRaw)
					? headerTokenRaw[0]
					: headerTokenRaw;
				const authToken =
					typeof socket.handshake.auth?.['token'] === 'string'
						? socket.handshake.auth['token']
						: typeof socket.handshake.auth?.['x-access-token'] === 'string'
							? socket.handshake.auth['x-access-token']
							: undefined;

				if (
					configuredAccessToken &&
					(headerToken === configuredAccessToken ||
						authToken === configuredAccessToken)
				) {
					return next();
				}

				// Parse cookies from handshake
				const cookieHeader = socket.handshake.headers.cookie;
				if (!cookieHeader) {
					return next(new Error('Authentication required'));
				}

				// Simple cookie parsing
				const cookies: Record<string, string> = {};
				cookieHeader.split(';').forEach(cookie => {
					const [name, value] = cookie.trim().split('=');
					if (name && value) {
						cookies[name] = value;
					}
				});

				const sessionId = cookies['argusdev_session'];
				if (!sessionId) {
					return next(new Error('Authentication required'));
				}

				const session = authService.validateSession(sessionId);
				if (!session) {
					return next(new Error('Session expired'));
				}

				// Store session info on socket for later use
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(socket as any).authSession = session;
				next();
			});

			this.io.on('connection', socket => {
				logger.info(`Web client connected: ${socket.id}`);

				socket.on('subscribe_session', (sessionId: string) => {
					const socketId = socket.id;

					// Check if switching sessions - leave previous room explicitly
					const previousSessionId = this.socketSubscriptions.get(socketId);
					if (previousSessionId && previousSessionId !== sessionId) {
						socket.leave(`session:${previousSessionId}`);
						if (isDevMode()) {
							logger.info(
								`Client ${socketId} switched from ${previousSessionId} to ${sessionId}`,
							);
						}
					}

					// Force leave ALL other session rooms (belt and suspenders)
					for (const room of socket.rooms) {
						if (
							room.startsWith('session:') &&
							room !== `session:${sessionId}`
						) {
							socket.leave(room);
						}
					}

					// Track subscription
					this.socketSubscriptions.set(socketId, sessionId);
					socket.join(`session:${sessionId}`);

					logger.info(`Client ${socketId} subscribed to session ${sessionId}`);

					// Find session and send current history
					const ptySession =
						globalSessionOrchestrator.findSession(sessionId)?.session;
					if (ptySession) {
						const fullHistory = Buffer.concat(ptySession.outputHistory).toString(
							'utf8',
						);
						socket.emit('terminal_data', {
							sessionId: ptySession.id,
							data: fullHistory,
						});
					}

					// Check for SDK session and send message history
					const sdkSession = sdkSessionManager.getSession(sessionId);
					if (sdkSession) {
						socket.emit('sdk_session_history', {
							sessionId: sdkSession.id,
							messages: sdkSession.messages,
							state: sdkSession.state,
							usage: sdkSession.usage,
							model: sdkSession.model,
						});
					}
				});

				socket.on('unsubscribe_session', (sessionId: string) => {
					const socketId = socket.id;
					logger.info(
						`Client ${socketId} unsubscribed from session ${sessionId}`,
					);

					// Clear from tracking if this was the tracked session
					if (this.socketSubscriptions.get(socketId) === sessionId) {
						this.socketSubscriptions.delete(socketId);
					}

					socket.leave(`session:${sessionId}`);
				});

				socket.on(
					'input',
					({sessionId, data}: {sessionId: string; data: string}) => {
						const session =
							globalSessionOrchestrator.findSession(sessionId)?.session;
						if (session) {
							session.process.write(data);
						}
					},
				);

				socket.on(
					'resize',
					({
						sessionId,
						cols,
						rows,
					}: {
						sessionId: string;
						cols: number;
						rows: number;
					}) => {
						const session =
							globalSessionOrchestrator.findSession(sessionId)?.session;
						if (session) {
							session.process.resize(cols, rows);
						}
					},
				);

				// Handle clipboard image paste
				socket.on(
					'paste_image',
					async ({
						sessionId,
						imageData,
						mimeType,
					}: {
						sessionId: string;
						imageData: string; // base64 data URL
						mimeType: string;
					}) => {
						try {
							// Validate MIME type
							if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
								socket.emit('image_path', {
									sessionId,
									error: 'Invalid image type',
								});
								return;
							}

							// Parse and validate data URL format
							const match = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
							if (!match || !match[2]) {
								socket.emit('image_path', {
									sessionId,
									error: 'Invalid image data',
								});
								return;
							}

							const base64Data = match[2];

							// Check size before decoding (base64 is ~33% larger than binary)
							const estimatedSize = (base64Data.length * 3) / 4;
							if (estimatedSize > MAX_IMAGE_SIZE) {
								socket.emit('image_path', {
									sessionId,
									error: 'Image too large (max 10MB)',
								});
								return;
							}

							const buffer = Buffer.from(base64Data, 'base64');

							// Determine extension from mime type
							const ext = mimeType.split('/')[1] || 'png';

							// Generate secure random filename
							const randomName = randomBytes(16).toString('hex');
							const filename = `${randomName}.${ext}`;
							const filePath = path.join(TEMP_IMAGE_DIR, filename);

							// Write file with restrictive permissions
							await writeFile(filePath, buffer, {mode: 0o600});

							// Send path back to client
							socket.emit('image_path', {sessionId, filePath});

							logger.info(`Saved clipboard image to ${filePath}`);
						} catch (error) {
							logger.error('Failed to save clipboard image:', error);
							socket.emit('image_path', {
								sessionId,
								error: 'Failed to save image',
							});
						}
					},
				);

				// Cleanup on disconnect
				socket.on('disconnect', () => {
					const socketId = socket.id;
					this.socketSubscriptions.delete(socketId);
					logger.info(`Client ${socketId} disconnected`);
				});
			});
		});
	}

	private setupSdkListeners() {
		sdkSessionManager.on('sdkSessionData', (session: SdkSession, event: SdkEvent) => {
			const room = `session:${session.id}`;

			// Transform raw Claude events into frontend-expected format
			if (event.type === 'system') {
				this.io?.to(room).emit('sdk_session_event', {
					sessionId: session.id,
					type: 'model_info',
					model: (event as SdkEvent & {model?: string}).model,
				});
			}

			if (event.type === 'assistant') {
				// Send the complete assistant message
				const lastMsg = session.messages[session.messages.length - 1];
				if (lastMsg) {
					this.io?.to(room).emit('sdk_session_event', {
						sessionId: session.id,
						type: 'message',
						message: lastMsg,
					});
				}
			}

			if (event.type === 'result') {
				const lastMsg = session.messages[session.messages.length - 1];
				if (lastMsg) {
					this.io?.to(room).emit('sdk_session_event', {
						sessionId: session.id,
						type: 'message',
						message: lastMsg,
					});
				}
				this.io?.to(room).emit('sdk_session_event', {
					sessionId: session.id,
					type: 'usage_update',
					usage: session.usage,
				});
			}

			// User messages (from sendMessage)
			if ((event as unknown as Record<string, unknown>)['type'] === 'user_message') {
				const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user');
				if (lastUserMsg) {
					this.io?.to(room).emit('sdk_session_event', {
						sessionId: session.id,
						type: 'message',
						message: lastUserMsg,
					});
				}
			}
		});

		sdkSessionManager.on('sdkSessionStateChanged', (session: SdkSession) => {
			// Send state change to subscribed clients
			this.io?.to(`session:${session.id}`).emit('sdk_session_event', {
				sessionId: session.id,
				type: 'state_change',
				state: session.state,
			});
			this.io?.emit('session_update', {
				id: session.id,
				state: session.state === 'connecting' ? 'busy' : session.state === 'closed' ? 'idle' : session.state,
				autoApprovalFailed: false,
				autoApprovalReason: undefined,
			});
		});

		sdkSessionManager.on('sdkSessionCreated', (session: SdkSession) => {
			logger.info(`API: SDK session created: ${session.id}`);
			this.io?.emit('session_update', {
				id: session.id,
				state: session.state,
				autoApprovalFailed: false,
				autoApprovalReason: undefined,
			});
		});

		sdkSessionManager.on('sdkSessionExit', (session: SdkSession) => {
			logger.info(`API: SDK session exited: ${session.id}`);
			this.io?.emit('session_update', {
				id: session.id,
				state: 'idle',
				autoApprovalFailed: false,
				autoApprovalReason: undefined,
			});
		});
	}

	private setupCoreListeners() {
		coreService.on('sessionData', (session, data) => {
			this.io?.to(`session:${session.id}`).emit('terminal_data', {
				sessionId: session.id,
				data,
			});
		});

		const notifyUpdate = (session: Session) => {
			this.io?.emit('session_update', toSessionUpdatePayload(session));
		};

		coreService.on('sessionStateChanged', session => {
			this.injectPendingTdPromptIfReady(session);
			notifyUpdate(session);
		});
		coreService.on('sessionUpdated', notifyUpdate);
		coreService.on('sessionCreated', session => {
			logger.info(`API: Session created: ${session.id}`);
			setTimeout(() => {
				this.persistSessionMetadataIfMissing(session);
			}, 500);
			notifyUpdate(session);
		});
		coreService.on('sessionDestroyed', session => {
			this.clearPendingTdPromptInjection(session.id);
			sessionStore.cancelAgentSessionDiscovery(session.id);
			const endedAt = Math.floor(Date.now() / 1000);
			try {
				sessionStore.markSessionEnded(session.id, endedAt);
				logger.info(`API: Session destroyed: ${session.id}, markEnded=success`);
				if (!sessionStore.getSessionById(session.id)) {
					this.pendingFallbackSessionEndTimes.set(session.id, endedAt);
				}
			} catch (error) {
				logger.info(`API: Session destroyed: ${session.id}, markEnded=failure`);
				logger.warn(
					`API: Failed to mark session ${session.id} as ended in store: ${String(error)}`,
				);
				this.pendingFallbackSessionEndTimes.set(session.id, endedAt);
			}
			notifyUpdate(session);
		});

		// TD review polling — detect tasks entering in_review and notify frontend
		const knownReviewIds = new Set<string>();
		const pollTdReviews = () => {
			try {
				const project = coreService.getSelectedProject();
				if (!project) return;
				const rawState = tdService.resolveProjectState(project.path);
				const projectConfig = loadProjectConfig(project.path);
				const state =
					projectConfig?.td?.enabled === false
						? {...rawState, enabled: false}
						: rawState;
				if (!state.enabled || !state.dbPath) return;

				const reader = new TdReader(state.dbPath);
				try {
					const reviewIssues = reader.listIssues({status: 'in_review'});
					const newReviews = reviewIssues.filter(
						i => !knownReviewIds.has(i.id),
					);
					if (newReviews.length > 0) {
						newReviews.forEach(i => knownReviewIds.add(i.id));
						this.io?.emit('td_review_ready', {
							issues: newReviews.map(i => ({
								id: i.id,
								title: i.title,
								priority: i.priority,
							})),
						});
						logger.info(
							`API: ${newReviews.length} new task(s) ready for review`,
						);
					}
					// Clean up IDs no longer in review
					for (const id of knownReviewIds) {
						if (!reviewIssues.some(i => i.id === id)) {
							knownReviewIds.delete(id);
						}
					}
				} finally {
					reader.close();
				}
			} catch {
				// Silent — td polling is best-effort
			}
		};
		// Poll every 30 seconds, start after 5s
		setTimeout(pollTdReviews, 5000);
		setInterval(pollTdReviews, 30000);

		// Setup TD issues.db watcher for auto-refresh
		this.setupTdDbWatcher();

		// Re-setup watcher when project changes
		coreService.on('projectSelected', () => {
			this.setupTdDbWatcher();
		});

		// Setup file watchers for external changes
		this.setupFileWatchers();
	}

	/**
	 * Setup file watcher on issues.db to auto-refresh TD board on external changes.
	 * Watches the selected project's issues.db and emits 'td_board_changed' on change.
	 */
	private setupTdDbWatcher(): void {
		// Clean up existing watcher
		this.teardownTdDbWatcher();

		const project = coreService.getSelectedProject();
		if (!project) {
			return;
		}

		const state = tdService.resolveProjectState(project.path);
		if (!state.dbPath) {
			return;
		}

		const dbPath = state.dbPath;

		try {
			this.tdDbWatcher = watch(dbPath, eventType => {
				if (eventType === 'change') {
					// Debounce to prevent fetch storms on rapid writes
					if (this.tdDbWatchDebounceTimer) {
						clearTimeout(this.tdDbWatchDebounceTimer);
					}
					this.tdDbWatchDebounceTimer = setTimeout(() => {
						logger.info(`API: TD issues.db changed, emitting td_board_changed`);
						this.io?.emit('td_board_changed');
					}, APIServer.TD_DB_WATCH_DEBOUNCE_MS);
				}
			});

			this.tdDbWatcher.on('error', err => {
				logger.warn(`API: TD issues.db watcher error: ${err}`);
			});

			logger.info(`API: Watching TD issues.db at ${dbPath}`);
		} catch (err) {
			logger.warn(`API: Failed to setup TD issues.db watcher: ${err}`);
		}
	}

	/**
	 * Teardown TD issues.db watcher and clear pending timers.
	 * Called on project change, server shutdown, or daemon stop.
	 */
	private teardownTdDbWatcher(): void {
		if (this.tdDbWatchDebounceTimer) {
			clearTimeout(this.tdDbWatchDebounceTimer);
			this.tdDbWatchDebounceTimer = null;
		}
		if (this.tdDbWatcher) {
			this.tdDbWatcher.close();
			this.tdDbWatcher = null;
			logger.info('API: Closed TD issues.db watcher');
		}
	}

	/**
	 * Setup file watchers for worktrees and projects.
	 * Forwards change events to connected clients via socket.io.
	 */
	private setupFileWatchers(): void {
		// Start watching projects.json global file
		fileWatcherService.startWatchingProjects();

		// Start watching the currently selected project's worktrees
		const selectedProject = coreService.getSelectedProject();
		if (selectedProject) {
			fileWatcherService.startWatchingWorktrees(selectedProject.path);
		}

		// Forward worktrees_changed events to clients
		fileWatcherService.on('worktrees_changed', (projectPath: string) => {
			logger.info(
				`API: File watcher detected worktrees change for ${projectPath}`,
			);
			this.io?.emit('worktrees_changed', {projectPath});
		});

		// Forward projects_changed events to clients
		fileWatcherService.on('projects_changed', () => {
			logger.info('API: File watcher detected projects.json change');

			// Reload projects from disk
			projectManager.loadProjects();

			this.io?.emit('projects_changed');
		});

		// Update watchers on project switch
		coreService.on('projectSelected', project => {
			fileWatcherService.updateWatchedProjects(project ? [project.path] : []);
		});
	}

	/**
	 * Stop the API server and cleanup all resources.
	 * Called during daemon shutdown.
	 */
	public async stop(): Promise<void> {
		// Cleanup TD watcher
		this.teardownTdDbWatcher();

		// Cleanup filesystem watchers
		fileWatcherService.stopAll();

		// Close Socket.IO
		if (this.io) {
			this.io.disconnectSockets(true);
			this.io.close();
			this.io = undefined;
		}

		// Close Fastify
		await this.app.close();
		logger.info('API Server stopped');
	}

	/**
	 * Get the access token for WebUI URL
	 */
	public getAccessToken(): string {
		const config = configurationManager.getConfiguration();
		return config.accessToken || '';
	}

	/**
	 * Check if authentication is configured
	 */
	public isAuthConfigured(): boolean {
		const config = configurationManager.getConfiguration();
		return !!(config.accessToken && config.passcodeHash);
	}

	/**
	 * Start the API server.
	 * @param port - Port to listen on
	 * @param host - Host to bind to
	 * @param devMode - If true, enables dev-mode startup behavior (like dev passcode output)
	 * @param allowRandomPortFallback - If true, retry with random ports on EADDRINUSE
	 * @returns Object containing the address and actual port used
	 */
	public async start(
		port: number = 3000,
		host: string = '127.0.0.1', // Bind to localhost only for security
		devMode: boolean = false,
		allowRandomPortFallback = false,
	): Promise<{address: string; port: number}> {
		// Wait for setup to complete before starting
		await this.setupPromise;

		const maxRetries = allowRandomPortFallback ? 10 : 1;
		let currentPort = port;

		void checkForUpdate().catch(error => {
			logger.debug(`Update check failed: ${String(error)}`);
		});

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				const address = await this.app.listen({port: currentPort, host});
				logger.info(`API Server running at ${address}`);

				// Display access URL with auth token if configured
				const accessToken = configurationManager.getAccessToken();
				const baseUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${currentPort}`;
				if (accessToken) {
					logger.info(`WebUI: ${baseUrl}/${accessToken}`);
					if (devMode) {
						logger.info(`Dev passcode: devdev`);
					}
				} else {
					logger.info(`Open in browser: ${baseUrl}`);
				}

				if (!this.hasRehydratedSessions) {
					try {
						await cleanupStartupScripts();
						await this.rehydratePersistedSessions();
						this.hasRehydratedSessions = true;
					} catch (error) {
						logger.warn(
							`API: Session rehydration failed during startup: ${String(error)}`,
						);
					}
				}
				return {address, port: currentPort};
			} catch (err: unknown) {
				const errorCode =
					err instanceof Error && 'code' in err
						? (err as NodeJS.ErrnoException).code
						: undefined;
				const isAddressInUse = errorCode === 'EADDRINUSE';
				const isPermissionError = errorCode === 'EACCES';

				if (isPermissionError) {
					throw new Error(
						`Cannot bind to port ${currentPort}: permission denied. Try a higher port or allow permission for this operation.`,
					);
				}

				if (
					isAddressInUse &&
					allowRandomPortFallback &&
					attempt < maxRetries - 1
				) {
					// Try a new random port when no port is configured.
					const newPort = generateRandomPort();
					logger.info(
						`Port ${currentPort} in use, retrying with port ${newPort} (attempt ${attempt + 2}/${maxRetries})`,
					);
					currentPort = newPort;
					continue;
				}

				if (isAddressInUse && !allowRandomPortFallback) {
					throw new Error(
						`Port ${currentPort} is already in use. Start with a different port using --port.`,
					);
				}

				logger.error('Failed to start API server', err);
				throw err;
			}
		}

		// Should not reach here, but satisfy TypeScript
		throw new Error('Failed to start API server after all retries');
	}
}

export const apiServer = new APIServer();
