/* global URL, RequestInit, Headers, fetch */
import {EventEmitter} from 'events';
import {io, Socket} from 'socket.io-client';
import {
	AgentConfig,
	GitProject,
	Project,
	SessionState,
	Worktree,
} from '../types/index.js';

export interface ApiSession {
	id: string;
	name?: string;
	path: string;
	state: SessionState;
	isActive: boolean;
	agentId?: string;
	pid?: number;
	autoApprovalFailed?: boolean;
	autoApprovalReason?: string;
}

export interface PathValidationResult {
	path: string;
	exists: boolean;
	isDirectory: boolean;
	isGitRepo: boolean;
}

export interface WebConfigLike {
	url: string;
	externalUrl?: string;
	hostname?: string;
	port: number;
	configDir: string;
	isCustomConfigDir: boolean;
}

interface TuiApiClientConfig {
	baseUrl?: string;
	accessToken?: string;
}

interface CreateWorktreeResponse {
	warnings?: string[];
	worktree?: {
		warnings?: string[];
	};
}

export interface SessionUpdatePayload {
	id: string;
	state: SessionState;
	autoApprovalFailed?: boolean;
	autoApprovalReason?: string;
}

export interface TerminalDataPayload {
	sessionId: string;
	data: string;
}

function parseUrlAndToken(input: string): {baseUrl: string; token?: string} {
	const parsed = new URL(input);
	const token = parsed.pathname.split('/').filter(Boolean)[0];
	return {
		baseUrl: parsed.origin,
		token,
	};
}

function buildDefaultBaseUrl(): string {
	const daemonUrl = process.env['ARGUSDEV_DAEMON_URL'];
	if (daemonUrl) {
		return parseUrlAndToken(daemonUrl).baseUrl;
	}

	const envPort = process.env['ARGUSDEV_PORT'];
	const port = envPort ? Number.parseInt(envPort, 10) : 3000;
	const resolvedPort = Number.isFinite(port) ? port : 3000;
	return `http://127.0.0.1:${resolvedPort}`;
}

export function worktreeBelongsToProject(
	worktreePath: string,
	projectPath: string,
): boolean {
	if (worktreePath.startsWith(projectPath)) {
		return true;
	}

	const projectName = projectPath.split('/').pop();
	if (!projectName) {
		return false;
	}

	return worktreePath.includes(`/.worktrees/${projectName}/`);
}

class TuiApiClient extends EventEmitter {
	private baseUrl = buildDefaultBaseUrl();
	private accessToken = process.env['ARGUSDEV_ACCESS_TOKEN'];
	private socket: Socket | null = null;

	configure(config: TuiApiClientConfig) {
		const previousBaseUrl = this.baseUrl;
		const previousToken = this.accessToken;

		if (config.baseUrl) {
			this.baseUrl = config.baseUrl;
		}
		if (config.accessToken !== undefined) {
			this.accessToken = config.accessToken;
		}

		const shouldResetSocket =
			previousBaseUrl !== this.baseUrl || previousToken !== this.accessToken;
		if (shouldResetSocket && this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
	}

	configureFromWebConfig(webConfig?: WebConfigLike) {
		if (!webConfig?.url) {
			return;
		}

		const parsed = parseUrlAndToken(webConfig.url);
		this.configure({
			baseUrl: parsed.baseUrl,
			accessToken: parsed.token || this.accessToken,
		});
	}

	connectSocket() {
		if (!this.socket) {
			const extraHeaders = this.accessToken
				? {'x-access-token': this.accessToken}
				: undefined;

			this.socket = io(this.baseUrl, {
				autoConnect: false,
				withCredentials: true,
				auth: this.accessToken ? {token: this.accessToken} : undefined,
				extraHeaders,
			});

			this.socket.on('connect', () => {
				this.emit('connect');
			});
			this.socket.on('disconnect', reason => {
				this.emit('disconnect', reason);
			});
			this.socket.on('connect_error', error => {
				this.emit('connect_error', error);
			});
			this.socket.on('session_update', (payload: SessionUpdatePayload) => {
				this.emit('session_update', payload);
			});
			this.socket.on('terminal_data', (payload: TerminalDataPayload) => {
				this.emit('terminal_data', payload);
			});
		}

		if (!this.socket.connected) {
			this.socket.connect();
		}
	}

	disconnectSocket() {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
	}

	subscribeSession(sessionId: string) {
		this.connectSocket();
		this.socket?.emit('subscribe_session', sessionId);
	}

	unsubscribeSession(sessionId: string) {
		this.socket?.emit('unsubscribe_session', sessionId);
	}

	sendInput(sessionId: string, data: string) {
		this.socket?.emit('input', {sessionId, data});
	}

	resizeSession(sessionId: string, cols: number, rows: number) {
		this.socket?.emit('resize', {sessionId, cols, rows});
	}

	private async request<T>(path: string, init?: RequestInit): Promise<T> {
		const headers = new Headers(init?.headers ?? {});
		if (this.accessToken) {
			headers.set('x-access-token', this.accessToken);
		}

		const response = await fetch(`${this.baseUrl}${path}`, {
			...init,
			headers,
		});

		if (!response.ok) {
			const payload = await response
				.json()
				.catch(() => ({error: response.statusText}));
			const errorMessage =
				typeof payload.error === 'string' ? payload.error : response.statusText;
			throw new Error(errorMessage);
		}

		return response.json() as Promise<T>;
	}

	async fetchState(): Promise<{selectedProject: GitProject | null}> {
		return this.request('/api/state');
	}

	async fetchProjects(): Promise<Project[]> {
		const response = await this.request<{projects: Project[]}>('/api/projects');
		return response.projects || [];
	}

	async fetchWorktrees(): Promise<Worktree[]> {
		return this.request('/api/worktrees');
	}

	async fetchSessions(): Promise<ApiSession[]> {
		return this.request('/api/sessions');
	}

	async fetchAgents(): Promise<{
		agents: AgentConfig[];
		defaultAgentId: string;
	}> {
		const response = await this.request<{
			agents: AgentConfig[];
			defaultAgentId: string;
		}>('/api/agents?includeDisabled=true');
		return {
			agents: response.agents || [],
			defaultAgentId: response.defaultAgentId,
		};
	}

	async findSessionByWorktreePath(path: string): Promise<ApiSession | null> {
		const sessions = await this.fetchSessions();
		return sessions.find(session => session.path === path) || null;
	}

	async fetchBranches(projectPath?: string): Promise<string[]> {
		const query = projectPath
			? `?projectPath=${encodeURIComponent(projectPath)}`
			: '';
		return this.request(`/api/branches${query}`);
	}

	async fetchDefaultBranch(projectPath?: string): Promise<string> {
		const query = projectPath
			? `?projectPath=${encodeURIComponent(projectPath)}`
			: '';
		const response = await this.request<{defaultBranch: string}>(
			`/api/branches/default${query}`,
		);
		return response.defaultBranch;
	}

	async validatePath(path: string): Promise<PathValidationResult> {
		return this.request(`/api/validate-path?path=${encodeURIComponent(path)}`);
	}

	async addProject(path: string, name?: string): Promise<void> {
		await this.request('/api/project/add', {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({path, name}),
		});
	}

	async removeProject(path: string): Promise<void> {
		await this.request('/api/project/remove', {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({path}),
		});
	}

	async selectProject(path: string): Promise<void> {
		await this.request('/api/project/select', {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({path}),
		});
	}

	async resetProject(): Promise<void> {
		await this.request('/api/project/reset', {
			method: 'POST',
		});
	}

	async createWorktree(params: {
		path: string;
		branch: string;
		baseBranch: string;
		copySessionData: boolean;
		copyClaudeDirectory: boolean;
		projectPath?: string;
	}): Promise<{warnings?: string[]}> {
		const response = await this.request<CreateWorktreeResponse>(
			'/api/worktree/create',
			{
				method: 'POST',
				headers: {'content-type': 'application/json'},
				body: JSON.stringify(params),
			},
		);

		return {
			warnings: response.warnings ?? response.worktree?.warnings,
		};
	}

	async deleteWorktree(params: {
		path: string;
		deleteBranch: boolean;
		projectPath?: string;
	}): Promise<void> {
		await this.request('/api/worktree/delete', {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify(params),
		});
	}

	async mergeWorktree(params: {
		sourceBranch: string;
		targetBranch: string;
		useRebase: boolean;
	}): Promise<void> {
		await this.request('/api/worktree/merge', {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify(params),
		});
	}

	async createSessionWithAgent(params: {
		path: string;
		agentId: string;
		options?: Record<string, boolean | string>;
		sessionName?: string;
	}): Promise<ApiSession> {
		const response = await this.request<{
			success: boolean;
			id: string;
			name?: string;
			agentId?: string;
		}>('/api/session/create-with-agent', {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify(params),
		});

		const sessions = await this.fetchSessions();
		const session = sessions.find(item => item.id === response.id);
		if (!session) {
			throw new Error('Session was created but could not be loaded');
		}

		return session;
	}

	async setSessionActive(id: string, isActive: boolean): Promise<void> {
		await this.request('/api/session/set-active', {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({id, isActive}),
		});
	}

	async cancelAutoApproval(id: string, reason?: string): Promise<void> {
		await this.request('/api/session/cancel-auto-approval', {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({id, reason}),
		});
	}
}

export const tuiApiClient = new TuiApiClient();
