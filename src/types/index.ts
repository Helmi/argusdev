import {IPty} from 'node-pty';
import type pkg from '@xterm/headless';
import {GitStatus} from '../utils/gitStatus.js';
import {Mutex, SessionStateData} from '../utils/mutex.js';

export type Terminal = InstanceType<typeof pkg.Terminal>;

export type SessionState =
	| 'idle'
	| 'busy'
	| 'waiting_input'
	| 'pending_auto_approval';

export type StateDetectionStrategy =
	| 'claude'
	| 'claude-sdk'
	| 'gemini'
	| 'codex'
	| 'cursor'
	| 'github-copilot'
	| 'cline'
	| 'pi';

export interface Worktree {
	path: string;
	branch?: string;
	isMainWorktree: boolean;
	hasSession: boolean;
	gitStatus?: GitStatus;
	gitStatusError?: string;
	warnings?: string[]; // Hook failures and other non-fatal issues
}

export interface Session {
	id: string;
	name?: string;
	worktreePath: string;
	agentId?: string; // ID of the agent/preset used to create this session
	process: IPty;
	output: string[]; // Recent output for state detection
	outputHistory: Buffer[]; // Full output history as buffers
	lastActivity: Date;
	isActive: boolean;
	terminal: Terminal; // Virtual terminal for state detection (xterm Terminal instance)
	stateCheckInterval: NodeJS.Timeout | undefined; // Interval for checking terminal state
	isPrimaryCommand: boolean; // Track if process was started with main command args
	commandConfig: CommandConfig | undefined; // Store command config for fallback
	detectionStrategy: StateDetectionStrategy | undefined; // State detection strategy for this session
	hookBasedDetection?: boolean; // When true, state updates arrive via HTTP hooks, not buffer polling
	partialHookDetection?: boolean; // Like hookBasedDetection but keeps PTY polling for waiting_input
	hookCleanup?: () => void; // Called on session end to remove generated hook config files
	devcontainerConfig: DevcontainerConfig | undefined; // Devcontainer configuration if session runs in container
	/**
	 * Mutex-protected session state data.
	 * Access via stateMutex.runExclusive() or stateMutex.update() to ensure thread-safe operations.
	 * Contains: state, pendingState, pendingStateStart, autoApprovalFailed, autoApprovalReason, autoApprovalAbortController
	 */
	stateMutex: Mutex<SessionStateData>;
}

export interface AutoApprovalResponse {
	needsPermission: boolean;
	reason?: string;
}

export interface SessionManager {
	sessions: Map<string, Session>; // Keyed by session ID
	getSession(sessionId: string): Session | undefined;
	getSessionByPath(worktreePath: string): Session | undefined; // For backwards compat
	getSessionsForWorktree(worktreePath: string): Session[]; // Get all sessions for a worktree
	renameSession(sessionId: string, name?: string): boolean;
	destroySession(sessionId: string): void;
	getAllSessions(): Session[];
	cancelAutoApproval(sessionId: string, reason?: string): void;
}

export interface ShortcutKey {
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	key: string;
}

export interface ShortcutConfig {
	returnToMenu: ShortcutKey;
	cancel: ShortcutKey;
}

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
	returnToMenu: {ctrl: true, key: 'e'},
	cancel: {key: 'escape'},
};

export interface StatusHook {
	command: string;
	enabled: boolean;
}

export interface StatusHookConfig {
	idle?: StatusHook;
	busy?: StatusHook;
	waiting_input?: StatusHook;
	pending_auto_approval?: StatusHook;
}

export interface WorktreeHook {
	command: string;
	enabled: boolean;
}

export interface WorktreeHookConfig {
	post_creation?: WorktreeHook;
}

/**
 * Result of worktree operations (create, delete, merge)
 * Includes optional warnings for non-fatal issues like hook failures
 */
export interface WorktreeOperationResult {
	success: boolean;
	warnings?: string[]; // Hook failures, etc.
}

export interface WorktreeConfig {
	autoDirectory: boolean;
	autoDirectoryPattern?: string; // Optional pattern for directory generation
	copySessionData?: boolean; // Whether to copy Claude session data by default
	sortByLastSession?: boolean; // Whether to sort worktrees by last opened session
}

export interface CommandConfig {
	command: string; // The main command to execute (default: 'claude')
	args?: string[]; // Arguments to pass to the command
	fallbackArgs?: string[]; // Fallback arguments if main command fails
}

export interface CommandPreset {
	id: string; // Unique identifier for the preset
	name: string; // User-friendly name for the preset
	command: string; // The main command to execute
	args?: string[]; // Arguments to pass to the command
	fallbackArgs?: string[]; // Fallback arguments if main command fails
	detectionStrategy?: StateDetectionStrategy; // State detection strategy (defaults to 'claude')
}

export interface CommandPresetsConfig {
	presets: CommandPreset[]; // List of available presets
	defaultPresetId: string; // ID of the default preset to use
	selectPresetOnStart?: boolean; // Whether to show preset selector before starting session
}

// ============================================================================
// Agent Configuration System (replaces CommandPreset)
// ============================================================================

/**
 * A single configurable option for an agent.
 * Options are rendered as form fields in the UI and assembled into argv at spawn.
 */
export interface AgentOption {
	id: string; // Stable identity for storage and constraints
	flag: string; // CLI flag (e.g., '--model') or empty for positional args
	label: string; // UI label
	description?: string; // Tooltip/help text
	type: 'boolean' | 'string';
	default?: boolean | string;
	choices?: {value: string; label?: string}[]; // If present, render as dropdown
	group?: string; // Mutual exclusivity group (options in same group are radio buttons)
}

/**
 * Configuration for an agent (CLI tool) or terminal.
 * Agents have structured options; terminals are plain shells.
 */
export interface AgentConfig {
	id: string;
	name: string;
	description?: string;
	kind: 'agent' | 'terminal';
	command: string; // Executable (e.g., 'claude', '$SHELL')
	baseArgs?: string[]; // Fixed args always passed (for migration/advanced use)
	baseEnv?: Record<string, string>; // Extra env vars always set for this agent
	options: AgentOption[];
	enabled?: boolean; // Whether this agent is available for new session selection (defaults to true)
	promptArg?: string; // Startup prompt passing mode: positional (empty), flag (e.g. '--prompt'), or 'none'
	prependCwd?: boolean; // Inject the worktree path as the first positional argument
	detectionStrategy?: StateDetectionStrategy; // For state detection (agents only)
	sessionType?: 'pty' | 'sdk'; // Session type: PTY terminal (default) or SDK subprocess with structured JSON
	icon?: string; // Brand icon ID or generic Lucide icon name
	iconColor?: string; // Hex color (only for generic icons)
}

// ============================================================================
// SDK Session Types (structured JSON subprocess, not PTY)
// ============================================================================

/** State of an SDK session, derived from structured JSON events */
export type SdkSessionState =
	| 'connecting'
	| 'idle'
	| 'busy'
	| 'waiting_input'
	| 'closed'
	| 'error';

/** A tool call pending user approval */
export interface SdkPendingApproval {
	id: string; // Tool use ID from the event
	toolName: string;
	input: Record<string, unknown>;
	timestamp: number;
}

/** Accumulated cost/usage for an SDK session */
export interface SdkUsage {
	totalCostUsd: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheCreationTokens: number;
	turns: number;
}

/** A message in the SDK session conversation */
export interface SdkMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'result';
	content: SdkContentBlock[];
	timestamp: number;
	usage?: Partial<SdkUsage>;
	costUsd?: number;
}

/** Content block within a message */
export type SdkContentBlock =
	| {type: 'text'; text: string}
	| {type: 'thinking'; text: string}
	| {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>}
	| {type: 'tool_result'; toolUseId: string; content: string; isError?: boolean}
	| {type: 'system_info'; text: string; model?: string; sessionId?: string};

// --- SDK Event Types (parsed from Claude CLI --output-format stream-json) ---

export interface SdkSystemEvent {
	type: 'system';
	subtype: 'init';
	session_id: string;
	model: string;
	tools: string[];
	cwd: string;
}

export interface SdkStreamEvent {
	type: 'stream_event';
	session_id: string;
	parent_tool_use_id: string | null;
	event: {
		type:
			| 'message_start'
			| 'content_block_start'
			| 'content_block_delta'
			| 'content_block_stop'
			| 'message_delta'
			| 'message_stop';
		index?: number;
		content_block?: {type: string; text?: string; id?: string; name?: string};
		delta?: {
			type: string;
			text?: string;
			stop_reason?: string;
			partial_json?: string;
		};
		message?: Record<string, unknown>;
		usage?: Record<string, unknown>;
	};
}

export interface SdkAssistantEvent {
	type: 'assistant';
	session_id: string;
	message: {
		role: 'assistant';
		content: Array<{
			type: string;
			text?: string;
			id?: string;
			name?: string;
			input?: Record<string, unknown>;
		}>;
		stop_reason: string | null;
		usage?: Record<string, unknown>;
	};
}

export interface SdkResultEvent {
	type: 'result';
	subtype: 'success' | 'error';
	session_id: string;
	result: string;
	is_error: boolean;
	duration_ms: number;
	num_turns: number;
	total_cost_usd: number;
	usage: Record<string, unknown>;
	stop_reason?: string;
}

export type SdkEvent =
	| SdkSystemEvent
	| SdkStreamEvent
	| SdkAssistantEvent
	| SdkResultEvent;

/** SDK session — parallel to Session (PTY) */
export interface SdkSession {
	id: string;
	name?: string;
	worktreePath: string;
	agentId: string;
	claudeSessionId?: string; // Claude's session_id from init event
	state: SdkSessionState;
	messages: SdkMessage[];
	pendingApproval?: SdkPendingApproval;
	usage: SdkUsage;
	model?: string;
	tools?: string[];
	lastActivity: Date;
	createdAt: Date;
}

/**
 * Agents configuration section in ConfigurationData.
 */
export interface AgentsConfig {
	agents: AgentConfig[];
	defaultAgentId: string;
	schemaVersion: number; // For future migrations
}

export interface TdConfig {
	enabled?: boolean; // Global default for td integration (project can override)
	autoStart?: boolean; // Auto-run `td start` for linked task sessions
	defaultPrompt?: string; // Default prompt template name for task-linked sessions
	injectTaskContext?: boolean; // Inject task context on agent startup
	injectTdUsage?: boolean; // Inject td usage instructions on agent startup
}

export interface QuickStartFlowConfig {
	branchTemplate?: string;
	promptTemplate?: string;
	agentId?: string;
	sessionNameTemplate?: string;
	[key: string]: unknown;
}

export interface QuickStartConfig {
	work?: QuickStartFlowConfig;
	review?: QuickStartFlowConfig;
	[key: string]: unknown;
}

export interface DevcontainerConfig {
	upCommand: string; // Command to start devcontainer
	execCommand: string; // Command to execute in devcontainer
}

export interface VersionCheckState {
	checkedAt: number;
	latestVersion?: string;
	latestTag?: string;
	latestVersionError?: string;
}

export interface ConfigurationData {
	shortcuts?: ShortcutConfig;
	statusHooks?: StatusHookConfig;
	worktreeHooks?: WorktreeHookConfig;
	worktree?: WorktreeConfig;
	command?: CommandConfig;
	commandPresets?: CommandPresetsConfig; // Legacy field - kept for migration
	agents?: AgentsConfig; // New agent configuration system
	autoApproval?: {
		enabled: boolean; // Whether auto-approval is enabled
		customCommand?: string; // Custom verification command; must output JSON matching AutoApprovalResponse
		timeout?: number; // Timeout in seconds for auto-approval verification (default: 30)
	};
	quickStart?: QuickStartConfig;
	td?: TdConfig; // TD startup defaults used across projects
	port?: number; // Port for web interface (generated randomly on first run if not set)
	webEnabled?: boolean; // Whether web interface is enabled
	// Authentication (new two-tier system)
	accessToken?: string; // 3-word token used as URL path (e.g., "apple-desk-river")
	passcodeHash?: string; // bcrypt hash of the user's passcode
	// Legacy field - kept for migration
	webAuthToken?: string; // Old token format (deprecated, will be migrated)
	updateCheck?: VersionCheckState;
}

// Project interfaces
export interface GitProject {
	name: string; // Project name (directory name)
	path: string; // Full path to the git repository
	relativePath: string; // Relative path (kept for compatibility, usually same as name)
	isValid: boolean; // Whether the project is a valid git repository
	error?: string; // Error message if project is invalid
}

/**
 * Project-specific metadata stored alongside the project.
 */
export interface ProjectMetadata {
	taskListNames?: string[]; // Previously used Claude task list names
}

export interface RecentProject {
	path: string;
	name: string;
	lastAccessed: number;
}

/**
 * Project entry in the managed project list.
 * Projects are explicitly added by users (no auto-discovery).
 */
export interface Project {
	path: string; // Absolute path (unique key)
	name: string; // Display name (default: directory name)
	description?: string; // Optional user description
	lastAccessed: number; // Unix timestamp
	isValid?: boolean; // Set to false if path doesn't exist on disk
	metadata?: ProjectMetadata; // Project-specific metadata
}

export interface IProjectManager {
	currentProject?: GitProject;

	selectProject(project: GitProject): void;
	getWorktreeService(projectPath?: string): IWorktreeService;

	// Project registry methods
	getProjects(): Project[];
	addProject(projectPath: string, description?: string): Project | null;
	removeProject(projectPath: string): boolean;
	updateProject(
		projectPath: string,
		updates: Partial<Pick<Project, 'name' | 'description'>>,
	): Project | null;
	validateProjects(): void;

	// Project validation
	validateGitRepository(path: string): Promise<boolean>;
}

// Branch resolution types
export interface RemoteBranchMatch {
	remote: string;
	branch: string;
	fullRef: string; // e.g., "origin/foo/bar-xyz"
}

export class AmbiguousBranchError extends Error {
	constructor(
		public branchName: string,
		public matches: RemoteBranchMatch[],
	) {
		super(
			`Ambiguous branch '${branchName}' found in multiple remotes: ${matches
				.map(m => m.fullRef)
				.join(', ')}. Please specify which remote to use.`,
		);
		this.name = 'AmbiguousBranchError';
	}
}

export interface IWorktreeService {
	getWorktreesEffect(options?: {
		sortByLastSession?: boolean;
	}): import('effect').Effect.Effect<
		Worktree[],
		import('../types/errors.js').GitError,
		never
	>;
	getDefaultBranchEffect(): import('effect').Effect.Effect<
		string,
		import('../types/errors.js').GitError,
		never
	>;
	getGitRootPath(): string;
	createWorktreeEffect(
		worktreePath: string,
		branch: string,
		baseBranch: string,
		copySessionData?: boolean,
		copyClaudeDirectory?: boolean,
	): import('effect').Effect.Effect<
		Worktree,
		| import('../types/errors.js').GitError
		| import('../types/errors.js').FileSystemError,
		never
	>;
	deleteWorktreeEffect(
		worktreePath: string,
		options?: {deleteBranch?: boolean},
	): import('effect').Effect.Effect<
		void,
		import('../types/errors.js').GitError,
		never
	>;
	mergeWorktreeEffect(
		sourceBranch: string,
		targetBranch: string,
		useRebase?: boolean,
	): import('effect').Effect.Effect<
		void,
		import('../types/errors.js').GitError,
		never
	>;
}
