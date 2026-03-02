// Session status represents the current state of a coding agent session
export type SessionStatus =
	| 'active'
	| 'idle'
	| 'error'
	| 'pending'
	| 'busy'
	| 'waiting_input';

// Agent types supported by the system
export type AgentType =
	| 'claude-code'
	| 'gemini-cli'
	| 'codex'
	| 'droid'
	| 'cursor'
	| 'custom';

// Map backend state to display status
export function mapSessionState(state: string): SessionStatus {
	switch (state) {
		case 'busy':
			return 'active';
		case 'waiting_input':
			return 'pending';
		case 'idle':
			return 'idle';
		default:
			return 'idle';
	}
}

// Theme types for terminal and UI color schemes
export type ThemeType =
	| 'default'
	| 'monokai'
	| 'solarized'
	| 'dracula'
	| 'nord'
	| 'light'
	| 'github'
	| 'solarized-light'
	| 'one-light'
	| 'atom-light';

// Monospace font options
export type FontType = 'jetbrains' | 'fira' | 'source' | 'ibm';

// Session from the backend API
export interface Session {
	id: string;
	name?: string;
	path: string;
	state: string;
	isActive: boolean;
	agentId?: string;
}

export interface ConversationSession {
	id: string;
	agentProfileId: string;
	agentProfileName: string;
	agentType: string;
	agentOptions: Record<string, unknown>;
	agentSessionId: string | null;
	agentSessionPath: string | null;
	worktreePath: string;
	branchName: string | null;
	projectPath: string | null;
	tdTaskId: string | null;
	tdSessionId: string | null;
	sessionName: string | null;
	contentPreview: string | null;
	intent: 'work' | 'review' | 'fix' | 'manual';
	createdAt: number;
	endedAt: number | null;
	isActive: boolean;
	state: string;
	missingSessionFile: boolean;
}

export interface ConversationListResponse {
	sessions: ConversationSession[];
	total: number;
	limit: number;
	offset: number;
}

export interface ConversationToolCall {
	name: string;
	input?: string;
	output?: string;
	isError?: boolean;
}

export interface ConversationThinkingBlock {
	content: string;
	tokenCount?: number;
}

export interface ConversationMessage {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	timestamp: number | null;
	content: string;
	preview: string;
	model?: string;
	toolCalls?: ConversationToolCall[];
	thinkingBlocks?: ConversationThinkingBlock[];
	rawType?: string;
}

export interface ConversationSessionMetadata {
	agentSessionId?: string;
	startedAt?: number;
	endedAt?: number;
	messageCount?: number;
	totalTokens?: number;
	estimatedCostUsd?: number;
	model?: string;
	options?: Record<string, unknown>;
}

export interface ConversationMessagesResponse {
	sessionId: string;
	session: ConversationSession;
	metadata: ConversationSessionMetadata;
	messages: ConversationMessage[];
	total: number;
	limit: number;
	offset: number;
	missingSessionFile: boolean;
	subAgentSessions: string[];
	error?: string;
}

// Git status for a worktree
export interface GitStatus {
	filesAdded: number;
	filesDeleted: number;
	aheadCount: number;
	behindCount: number;
	parentBranch: string | null;
}

// Changed file in a worktree
export interface ChangedFile {
	path: string;
	status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
	additions: number;
	deletions: number;
}

// Directory entry for file browser
export interface DirectoryEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size?: number;
}

// Worktree from the backend API
export interface Worktree {
	path: string;
	branch?: string;
	isMainWorktree: boolean;
	hasSession: boolean;
	gitStatus?: GitStatus;
	gitStatusError?: string;
}

/**
 * Project-specific metadata stored alongside the project.
 */
export interface ProjectMetadata {
	taskListNames?: string[]; // Previously used Claude task list names
}

// Project from the backend API
export interface Project {
	name: string;
	path: string;
	description?: string;
	lastAccessed: number;
	isValid?: boolean;
	metadata?: ProjectMetadata; // Project-specific metadata
}

// Connection status for Socket.IO
export type ConnectionStatus =
	| 'connected'
	| 'connecting'
	| 'disconnected'
	| 'error';

// Agent option (single configurable parameter for an agent)
export interface AgentOption {
	id: string; // Stable identity for storage/constraints
	flag: string; // CLI flag (e.g., '--model') or empty for positional args
	label: string; // UI label
	description?: string; // Tooltip/help text
	type: 'boolean' | 'string';
	default?: boolean | string;
	choices?: {value: string; label?: string}[]; // If present, render as dropdown
	group?: string; // Mutual exclusivity group
}

// Agent configuration (CLI tool or terminal)
export interface AgentConfig {
	id: string;
	name: string;
	description?: string;
	kind: 'agent' | 'terminal';
	command: string; // Executable (e.g., 'claude', '$SHELL')
	baseArgs?: string[]; // Fixed args always passed
	options: AgentOption[];
	enabled?: boolean; // Whether this agent is selectable for new sessions (defaults to true)
	promptArg?: string; // Startup prompt passing mode: positional, explicit flag (e.g. --prompt), or 'none'
	detectionStrategy?: string; // For state detection (agents only)
	icon?: string; // Brand icon ID or generic Lucide icon name
	iconColor?: string; // Hex color (only for generic icons)
}

// Agents config from API
export interface AgentsConfig {
	agents: AgentConfig[];
	defaultAgentId: string;
	schemaVersion: number;
}

// Status hooks configuration
export interface StatusHooks {
	onIdle: string;
	onBusy: string;
	onWaitingInput: string;
	onPendingAutoApproval: string;
}

// Worktree hooks configuration
export interface WorktreeHooks {
	postCreation: string;
}

// --- TD Integration Types ---

export interface TdAvailability {
	binaryAvailable: boolean;
	version: string | null;
	binaryPath: string | null;
}

export interface TdProjectState {
	enabled: boolean;
	initialized: boolean;
	binaryAvailable: boolean;
	todosDir: string | null;
	dbPath: string | null;
	tdRoot: string | null;
}

export interface TdProjectConfig {
	enabled?: boolean;
	autoStart?: boolean;
	defaultPrompt?: string;
	defaultFixPrompt?: string;
	defaultReviewPrompt?: string;
	reviewPrompt?: string;
	[key: string]: unknown;
}

export interface TdStatus {
	availability: TdAvailability;
	projectState: TdProjectState | null;
	projectConfig?: TdProjectConfig | null;
}

export interface TdIssue {
	id: string;
	title: string;
	description: string;
	status: string;
	type: string;
	priority: string;
	points: number;
	labels: string;
	parent_id: string;
	acceptance: string;
	implementer_session: string;
	reviewer_session: string;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	deleted_at: string | null;
	minor: number;
	created_branch: string;
	creator_session: string;
	sprint: string;
	defer_until: string | null;
	due_date: string | null;
	defer_count: number;
}

export interface TdHandoffParsed {
	id: string;
	issueId: string;
	sessionId: string;
	done: string[];
	remaining: string[];
	decisions: string[];
	uncertain: string[];
	timestamp: string;
}

export interface TdIssueFile {
	id: string;
	issue_id: string;
	file_path: string;
	role: string;
}

export interface TdComment {
	id: string;
	issue_id: string;
	session_id: string;
	text: string;
	created_at: string;
}

export interface TdIssueWithChildren extends TdIssue {
	children: TdIssue[];
	handoffs: TdHandoffParsed[];
	files: TdIssueFile[];
	comments: TdComment[];
}

export interface TdPromptTemplate {
	name: string;
	path: string;
	source?: 'project' | 'global';
	effective?: boolean;
	overridden?: boolean;
	overridesGlobal?: boolean;
	content?: string;
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

export interface ProjectConfig {
	scripts?: {
		setup?: string;
		teardown?: string;
	};
	td?: {
		enabled?: boolean;
		autoStart?: boolean;
		defaultPrompt?: string;
		defaultFixPrompt?: string;
		defaultReviewPrompt?: string;
		reviewPrompt?: string;
	};
	agentDefaults?: {
		agentId?: string;
		options?: Record<string, boolean | string>;
	};
	quickStart?: QuickStartConfig;
	[key: string]: unknown;
}

export interface UpdateInfo {
	currentVersion: string;
	latestVersion?: string;
	latestTag?: string;
	checkedAt?: number;
	isUpdateAvailable: boolean;
	isStale: boolean;
	source: 'cache' | 'network';
	error?: string;
}

// Application configuration
export interface AppConfig {
	// Auto approval
	autoApprovalEnabled: boolean;
	autoApprovalTimeout: number;

	// Worktree defaults
	copySessionDataByDefault: boolean;
	sortByLastSession: boolean;
	autoGenerateDirectories: boolean;
	worktreePathTemplate: string;

	// Agents
	agents: AgentConfig[];

	// Hooks
	statusHooks: StatusHooks;
	worktreeHooks: WorktreeHooks;
	quickStart?: QuickStartConfig;
	raw?: Record<string, unknown>;
}
