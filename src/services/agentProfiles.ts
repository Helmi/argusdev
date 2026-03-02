import {AgentConfig} from '../types/index.js';

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
					{value: 'sonnet', label: 'Sonnet'},
					{value: 'opus', label: 'Opus'},
					{value: 'haiku', label: 'Haiku'},
				],
			},
		],
		detectionStrategy: 'claude',
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
					{value: 'read,grep,find,ls', label: 'Read-only'},
					{value: 'read,edit,write,grep,find,ls', label: 'Safe (no bash)'},
					{value: 'read,bash,edit,write', label: 'Default (includes bash)'},
					{
						value: 'read,bash,edit,write,grep,find,ls',
						label: 'All tools',
					},
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
					{value: 'off', label: 'Off'},
					{value: 'minimal', label: 'Minimal'},
					{value: 'low', label: 'Low'},
					{value: 'medium', label: 'Medium'},
					{value: 'high', label: 'High'},
					{value: 'xhigh', label: 'Extra High'},
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
					{value: 'enabled', label: 'Enabled'},
					{value: 'disabled', label: 'Disabled'},
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
