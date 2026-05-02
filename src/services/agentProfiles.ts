import {AgentConfig, AgentOption, AgentOptionChoice} from '../types/index.js';

/**
 * Sentinel `args` value that suppresses the option's CLI flag entirely.
 * Use it when "no flag" is a meaningful state distinct from any concrete value
 * — e.g. Pi's `--tools` flag where omitting it enables all tools, not just the
 * union of named ones. Recognized in configurationManager.buildAgentArgs.
 */
export const OMIT_FLAG_VALUE = '__omit__';

/**
 * Tokenize a choice's `args` string. Whitespace-separated tokens; quoting and
 * shell escapes are not supported (CLI flags rarely need them, and adding a
 * shell parser would surprise users). Empty string returns [].
 */
export function tokenizeChoiceArgs(raw: string): string[] {
	return raw.trim().split(/\s+/).filter(Boolean);
}

/**
 * Migrate any choice shape to the new `{label, args}` form. Accepts the
 * legacy `{value, label?}` shape so existing user configs and any cached
 * defaults survive a daemon upgrade. Drops malformed entries silently
 * rather than throwing — corrupted profile data shouldn't lock a user out.
 */
export function normalizeAgentOptionChoices(
	raw: unknown,
): AgentOptionChoice[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out: AgentOptionChoice[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') continue;
		const e = entry as Record<string, unknown>;
		const argsField = typeof e['args'] === 'string' ? (e['args'] as string) : undefined;
		const valueField = typeof e['value'] === 'string' ? (e['value'] as string) : undefined;
		const labelField = typeof e['label'] === 'string' ? (e['label'] as string) : undefined;
		const args = argsField ?? valueField;
		if (args === undefined || args === '') continue;
		const label = labelField && labelField.length > 0 ? labelField : args;
		out.push({label, args});
	}
	return out;
}

export function normalizeAgentOption(option: AgentOption): AgentOption {
	if (!option.choices) return option;
	const normalized = normalizeAgentOptionChoices(option.choices);
	if (!normalized) {
		const {choices: _omitted, ...rest} = option;
		return rest as AgentOption;
	}
	return {...option, choices: normalized};
}

export interface DetectableAgent {
	id: string;
	command: string;
	name: string;
}

export const DETECTABLE_AGENTS: DetectableAgent[] = [
	{id: 'claude', command: 'claude', name: 'Claude Code'},
	{id: 'codex', command: 'codex', name: 'Codex CLI'},
	{id: 'gemini', command: 'gemini', name: 'Gemini CLI'},
	{id: 'pi', command: 'pi', name: 'Pi Coding Agent'},
	{id: 'cursor', command: 'cursor agent', name: 'Cursor Agent'},
	{id: 'droid', command: 'droid', name: 'Droid'},
	{id: 'kilocode', command: 'kilocode', name: 'Kilocode'},
	{id: 'opencode', command: 'opencode', name: 'Opencode'},
];

const PROFILES: Record<string, AgentConfig> = {
	claude: {
		id: 'claude',
		name: 'Claude Code',
		description: 'Anthropic Claude CLI for coding assistance',
		kind: 'agent',
		command: 'claude',
		icon: 'claude',
		baseEnv: {CLAUDE_CODE_NO_FLICKER: '1'},
		options: [
			{
				id: 'yolo',
				flag: '--dangerously-skip-permissions',
				label: 'YOLO Mode',
				description: 'Skip all permission prompts',
				type: 'boolean',
				default: false,
			},
			{
				id: 'continue',
				flag: '--continue',
				label: 'Continue',
				description: 'Continue the most recent conversation',
				type: 'boolean',
				default: false,
				group: 'resume-mode',
			},
			{
				id: 'resume',
				flag: '--resume',
				label: 'Resume',
				description: 'Resume a specific conversation by ID',
				type: 'string',
				group: 'resume-mode',
			},
			{
				id: 'model',
				flag: '--model',
				label: 'Model',
				description: 'Model to use',
				type: 'string',
				choices: [
					{label: 'Sonnet', args: 'sonnet'},
					{label: 'Opus', args: 'opus'},
					{label: 'Haiku', args: 'haiku'},
				],
			},
		],
		detectionStrategy: 'claude',
	},
	'claude-sdk': {
		id: 'claude-sdk',
		name: 'Claude (SDK)',
		description:
			'Claude Code with structured JSON streaming — reliable state detection, tool approvals, cost tracking',
		kind: 'agent',
		command: 'claude',
		icon: 'claude',
		sessionType: 'sdk',
		baseArgs: [
			'-p',
			'--output-format',
			'stream-json',
			'--verbose',
			'--include-partial-messages',
		],
		promptArg: 'none',
		options: [
			{
				id: 'yolo',
				flag: '--dangerously-skip-permissions',
				label: 'YOLO Mode',
				description: 'Skip all permission prompts',
				type: 'boolean',
				default: false,
			},
			{
				id: 'model',
				flag: '--model',
				label: 'Model',
				description: 'Model to use',
				type: 'string',
				choices: [
					{label: 'Sonnet', args: 'sonnet'},
					{label: 'Opus', args: 'opus'},
					{label: 'Haiku', args: 'haiku'},
				],
			},
		],
		detectionStrategy: 'claude-sdk',
	},
	codex: {
		id: 'codex',
		name: 'Codex CLI',
		description: 'OpenAI Codex CLI',
		kind: 'agent',
		command: 'codex',
		icon: 'openai',
		options: [
			{
				id: 'yolo',
				flag: '--dangerously-bypass-approvals-and-sandbox',
				label: 'YOLO Mode',
				description: 'Skip all permission checks and sandbox (dangerous)',
				type: 'boolean',
				default: false,
				group: 'auto-mode',
			},
			{
				id: 'full-auto',
				flag: '--full-auto',
				label: 'Full Auto',
				description: 'Auto-approve with workspace sandbox (safer)',
				type: 'boolean',
				default: false,
				group: 'auto-mode',
			},
			{
				id: 'model',
				flag: '-m',
				label: 'Model',
				description: 'Model to use',
				type: 'string',
			},
		],
		detectionStrategy: 'codex',
	},
	gemini: {
		id: 'gemini',
		name: 'Gemini CLI',
		description: 'Google Gemini CLI',
		kind: 'agent',
		command: 'gemini',
		icon: 'gemini',
		options: [
			{
				id: 'yolo',
				flag: '-y',
				label: 'YOLO Mode',
				description: 'Auto-approve all actions',
				type: 'boolean',
				default: false,
			},
			{
				id: 'resume',
				flag: '-r',
				label: 'Resume',
				description: 'Resume session (use "latest" or index)',
				type: 'string',
			},
			{
				id: 'model',
				flag: '-m',
				label: 'Model',
				description: 'Model to use',
				type: 'string',
			},
		],
		detectionStrategy: 'gemini',
	},
	pi: {
		id: 'pi',
		name: 'Pi Coding Agent',
		description: 'Pi Coding Agent (pi CLI)',
		kind: 'agent',
		command: 'pi',
		icon: 'pi',
		options: [
			{
				id: 'tools',
				flag: '--tools',
				label: 'Tools',
				description:
					'Enabled tools (controls permissions). Default disables bash for safety.',
				type: 'string',
				default: 'read,edit,write,grep,find,ls',
				choices: [
					{label: 'Read-only', args: 'read,grep,find,ls'},
					{label: 'Safe (no bash)', args: 'read,edit,write,grep,find,ls'},
					{label: 'Default (includes bash)', args: 'read,bash,edit,write'},
					{label: 'All tools (no restriction)', args: OMIT_FLAG_VALUE},
				],
			},
			{
				id: 'continue',
				flag: '--continue',
				label: 'Continue',
				description: 'Continue previous session',
				type: 'boolean',
				default: false,
				group: 'resume-mode',
			},
			{
				id: 'resume',
				flag: '--resume',
				label: 'Resume',
				description: 'Select a session to resume',
				type: 'boolean',
				default: false,
				group: 'resume-mode',
			},
			{
				id: 'session',
				flag: '--session',
				label: 'Session File',
				description: 'Use specific session file',
				type: 'string',
			},
			{
				id: 'session-dir',
				flag: '--session-dir',
				label: 'Session Dir',
				description: 'Directory for session storage and lookup',
				type: 'string',
			},
			{
				id: 'thinking',
				flag: '--thinking',
				label: 'Thinking',
				description: 'Thinking level',
				type: 'string',
				choices: [
					{label: 'Off', args: 'off'},
					{label: 'Minimal', args: 'minimal'},
					{label: 'Low', args: 'low'},
					{label: 'Medium', args: 'medium'},
					{label: 'High', args: 'high'},
					{label: 'Extra High', args: 'xhigh'},
				],
			},
		],
		detectionStrategy: 'pi',
	},
	cursor: {
		id: 'cursor',
		name: 'Cursor',
		description: 'Cursor Agent CLI',
		kind: 'agent',
		command: 'cursor agent',
		icon: 'cursor',
		options: [
			{
				id: 'force',
				flag: '-f',
				label: 'Force',
				description: 'Force allow commands unless explicitly denied',
				type: 'boolean',
				default: false,
			},
			{
				id: 'sandbox',
				flag: '--sandbox',
				label: 'Sandbox',
				description: 'Sandbox mode',
				type: 'string',
				choices: [
					{label: 'Enabled', args: 'enabled'},
					{label: 'Disabled', args: 'disabled'},
				],
			},
			{
				id: 'resume',
				flag: '--resume',
				label: 'Resume',
				description: 'Resume a chat session by ID',
				type: 'string',
			},
			{
				id: 'model',
				flag: '--model',
				label: 'Model',
				description: 'Model to use',
				type: 'string',
			},
		],
		detectionStrategy: 'cursor',
	},
	droid: {
		id: 'droid',
		name: 'Droid',
		description: 'Droid CLI',
		kind: 'agent',
		command: 'droid',
		icon: 'droid',
		options: [
			{
				id: 'resume',
				flag: '-r',
				label: 'Resume',
				description: 'Resume session (defaults to last)',
				type: 'string',
			},
		],
	},
	kilocode: {
		id: 'kilocode',
		name: 'Kilocode',
		description: 'Kilocode CLI',
		kind: 'agent',
		command: 'kilocode',
		icon: 'kilo',
		options: [
			{
				id: 'yolo',
				flag: '--yolo',
				label: 'YOLO Mode',
				description: 'Auto-approve all tool permissions',
				type: 'boolean',
				default: false,
			},
			{
				id: 'continue',
				flag: '-c',
				label: 'Continue',
				description: 'Resume last conversation',
				type: 'boolean',
				default: false,
			},
			{
				id: 'session',
				flag: '-s',
				label: 'Session',
				description: 'Resume specific session by ID',
				type: 'string',
			},
			{
				id: 'model',
				flag: '-mo',
				label: 'Model',
				description: 'Model to use',
				type: 'string',
			},
		],
	},
	opencode: {
		id: 'opencode',
		name: 'Opencode',
		description: 'Opencode CLI',
		kind: 'agent',
		command: 'opencode',
		icon: 'opencode',
		prependCwd: true,
		options: [
			{
				id: 'continue',
				flag: '-c',
				label: 'Continue',
				description: 'Resume last session',
				type: 'boolean',
				default: false,
			},
			{
				id: 'session',
				flag: '-s',
				label: 'Session',
				description: 'Resume specific session by ID',
				type: 'string',
			},
			{
				id: 'model',
				flag: '-m',
				label: 'Model',
				description: 'Model (format: provider/model)',
				type: 'string',
			},
		],
	},
	terminal: {
		id: 'terminal',
		name: 'Terminal',
		description: 'Plain shell session',
		kind: 'terminal',
		command: '$SHELL',
		icon: 'terminal',
		iconColor: '#6B7280',
		options: [],
	},
};

function deepCloneAgentConfig(profile: AgentConfig): AgentConfig {
	return {
		...profile,
		options: profile.options.map(option => ({
			...option,
			choices: option.choices?.map(choice => ({...choice})),
		})),
	};
}

export function getAgentProfileById(id: string): AgentConfig | undefined {
	const profile = PROFILES[id];
	return profile ? deepCloneAgentConfig(profile) : undefined;
}

export function getAgentProfilesByIds(ids: string[]): AgentConfig[] {
	return ids
		.map(id => getAgentProfileById(id))
		.filter((profile): profile is AgentConfig => !!profile);
}

export function getAllAgentProfiles(): AgentConfig[] {
	return Object.keys(PROFILES)
		.map(id => getAgentProfileById(id))
		.filter((profile): profile is AgentConfig => !!profile);
}

export function getTerminalAgentProfile(): AgentConfig {
	return getAgentProfileById('terminal')!;
}
