import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {Effect} from 'effect';
import {coreService} from './coreService.js';

const mockGetAllActiveSessions = vi.fn<() => unknown[]>(() => []);

const mockExecFileSync = vi.fn();
const mockLoadPromptTemplatesByScope = vi.fn();
const mockTdReaderGetIssueWithDetails = vi.fn();
const mockCreateWorktreeEffect = vi.fn();
const mockSessionStoreQuerySessions = vi.fn<() => unknown[]>(() => []);
const mockSessionStoreGetSessionById = vi.fn<() => unknown | null>(() => null);
const mockSessionStoreCreateSessionRecord = vi.fn();
const mockSessionStoreScheduleDiscovery = vi.fn();
const mockSessionStoreCancelDiscovery = vi.fn();
const mockSessionStoreMarkSessionEnded = vi.fn();
const mockSessionStoreMarkSessionResumed = vi.fn();
const mockSessionStoreHydratePreview = vi.fn(async () => {});
const mockSessionStoreGetLatestByTdSessionId = vi.fn(() => null);
const mockSessionStoreCountSessions = vi.fn(() => 0);
const mockSessionStoreGetOriginalWorkTdSessionId = vi.fn(() => null);

vi.mock('child_process', async importOriginal => {
	const actual = await importOriginal<typeof import('child_process')>();
	return {
		...actual,
		execFileSync: mockExecFileSync,
	};
});

vi.mock('../utils/projectConfig.js', () => ({
	loadProjectConfig: vi.fn(() => ({td: {enabled: true, autoStart: true}})),
	getProjectConfigPath: vi.fn(() => '/repo/.cacd/config.json'),
	saveProjectConfig: vi.fn(() => '/repo/.cacd/config.json'),
	loadPromptTemplatesByScope: mockLoadPromptTemplatesByScope,
	loadPromptTemplateByScope: vi.fn(() => null),
	savePromptTemplateByScope: vi.fn(),
	deletePromptTemplateByScope: vi.fn(() => true),
}));

vi.mock('./configurationManager.js', () => ({
	configurationManager: {
		getTdConfig: vi.fn(() => ({
			enabled: true,
			autoStart: true,
			injectTdUsage: true,
		})),
		getAccessToken: vi.fn(() => ''),
		setTdConfig: vi.fn(),
		getConfiguration: vi.fn(() => ({accessToken: '', passcodeHash: 'hash'})),
		getAgentById: vi.fn(() => ({
			id: 'codex',
			name: 'Codex',
			kind: 'agent',
			command: 'codex',
			options: [],
			enabled: true,
		})),
		validateAgentOptions: vi.fn(() => []),
		buildAgentArgs: vi.fn(() => []),
	},
}));

vi.mock('./projectManager.js', () => ({
	projectManager: {
		getProjects: vi.fn(() => [{path: '/repo', name: 'Repo'}]),
		instance: {
			addTaskListName: vi.fn(),
			getTaskListNames: vi.fn(() => []),
			removeTaskListName: vi.fn(() => true),
		},
	},
}));

vi.mock('./authService.js', () => ({
	authService: {
		validateSession: vi.fn(() => ({
			id: 'session',
			expiresAt: Date.now() + 60000,
		})),
		checkRateLimit: vi.fn(() => ({allowed: true, attemptsRemaining: 3})),
		verifyPasscode: vi.fn(async () => true),
		recordAttempt: vi.fn(),
		createSession: vi.fn(() => ({id: 'session'})),
		invalidateSession: vi.fn(),
	},
}));

vi.mock('./coreService.js', () => ({
	coreService: {
		on: vi.fn(),
		getSelectedProject: vi.fn(() => null),
		getState: vi.fn(() => ({
			worktrees: [],
			sessions: [],
			selectedWorktree: undefined,
			availableBranches: [],
			repositoryPath: null,
			mainWorktreePath: null,
		})),
		selectProject: vi.fn(async () => {}),
		emitProjectAdded: vi.fn(),
		emitProjectRemoved: vi.fn(),
		refreshWorktrees: vi.fn(async () => {}),
		worktreeService: {
			getAllBranchesEffect: vi.fn(),
			createWorktreeEffect: (...args: unknown[]) =>
				mockCreateWorktreeEffect(...args),
			deleteWorktreeEffect: vi.fn(),
			mergeWorktreeEffect: vi.fn(),
		},
		sessionManager: {
			getSession: vi.fn(),
			destroySession: vi.fn(),
			renameSession: vi.fn(),
			getAllSessions: vi.fn(() => []),
			createSessionWithAgentEffect: vi.fn(),
			setSessionActive: vi.fn(),
		},
	},
}));

vi.mock('./tdService.js', () => ({
	tdService: {
		isAvailable: vi.fn(() => true),
		checkAvailability: vi.fn(() => ({
			binaryAvailable: true,
			version: 'test',
			binaryPath: '/usr/bin/td',
		})),
		resolveProjectState: vi.fn(() => ({
			enabled: true,
			initialized: true,
			binaryAvailable: true,
			todosDir: '/repo/.todos',
			dbPath: '/repo/.todos/issues.db',
			tdRoot: '/repo',
		})),
	},
}));

vi.mock('./tdReader.js', () => ({
	TdReader: vi.fn().mockImplementation(() => ({
		getIssueWithDetails: mockTdReaderGetIssueWithDetails,
		listIssues: vi.fn(() => []),
		close: vi.fn(),
	})),
}));

vi.mock('./globalSessionOrchestrator.js', () => ({
	globalSessionOrchestrator: {
		getAllActiveSessions: mockGetAllActiveSessions,
		getManagerForProject: () => coreService.sessionManager,
		findSession: (id: string) => {
			const session = (
				coreService.sessionManager as unknown as {
					getSession: (id: string) => unknown;
				}
			).getSession(id);
			return session
				? {session, manager: coreService.sessionManager}
				: undefined;
		},
	},
}));

vi.mock('./sessionStore.js', () => ({
	sessionStore: {
		querySessions: mockSessionStoreQuerySessions,
		getSessionById: mockSessionStoreGetSessionById,
		createSessionRecord: mockSessionStoreCreateSessionRecord,
		scheduleAgentSessionDiscovery: mockSessionStoreScheduleDiscovery,
		cancelAgentSessionDiscovery: mockSessionStoreCancelDiscovery,
		markSessionEnded: mockSessionStoreMarkSessionEnded,
		markSessionResumed: mockSessionStoreMarkSessionResumed,
		hydrateSessionContentPreview: mockSessionStoreHydratePreview,
		getLatestByTdSessionId: mockSessionStoreGetLatestByTdSessionId,
		countSessions: mockSessionStoreCountSessions,
		getOriginalWorkTdSessionId: mockSessionStoreGetOriginalWorkTdSessionId,
	},
}));

describe('APIServer td create-with-agent validation ordering', () => {
	interface InjectRequest {
		method: string;
		url: string;
		headers?: Record<string, string>;
		payload?: unknown;
	}

	interface InjectResponse {
		statusCode: number;
		body: string;
	}

	interface TestApp {
		inject: (req: InjectRequest) => Promise<InjectResponse>;
		close: () => Promise<void>;
	}

	let apiServer: {setupPromise: Promise<void>; app: TestApp};

	beforeAll(async () => {
		mockLoadPromptTemplatesByScope.mockReturnValue([
			{
				name: 'Begin Work on Task',
				path: '/tmp/Begin Work on Task.md',
				content: 'Work on {{task.id}}: {{task.title}}',
				source: 'global',
			},
		]);
		const mod = await import('./apiServer.js');
		apiServer = mod.apiServer as unknown as {
			setupPromise: Promise<void>;
			app: TestApp;
		};
		await apiServer.setupPromise;
	});

	afterAll(async () => {
		await apiServer.app.close();
	});

	beforeEach(() => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
					setSessionActive: ReturnType<typeof vi.fn>;
					getSession: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockExecFileSync.mockReset();
		mockGetAllActiveSessions.mockReset();
		mockGetAllActiveSessions.mockReturnValue([]);
		mockTdReaderGetIssueWithDetails.mockReset();
		mockCreateWorktreeEffect.mockReset();
		mockSessionStoreQuerySessions.mockReset();
		mockSessionStoreGetSessionById.mockReset();
		mockSessionStoreCreateSessionRecord.mockReset();
		mockSessionStoreScheduleDiscovery.mockReset();
		mockSessionStoreCancelDiscovery.mockReset();
		mockSessionStoreMarkSessionEnded.mockReset();
		mockSessionStoreMarkSessionResumed.mockReset();
		mockSessionStoreHydratePreview.mockReset();
		mockSessionStoreGetLatestByTdSessionId.mockReset();
		mockSessionStoreCountSessions.mockReset();
		mockSessionStoreGetOriginalWorkTdSessionId.mockReset();
		mockSessionStoreQuerySessions.mockReturnValue([]);
		mockSessionStoreGetSessionById.mockReturnValue(null);
		mockSessionStoreCountSessions.mockReturnValue(0);
		mockSessionStoreGetOriginalWorkTdSessionId.mockReturnValue(null);
		mockedSessionManager.createSessionWithAgentEffect.mockReset();
		mockedSessionManager.createSessionWithAgentEffect.mockReturnValue(
			Effect.succeed({
				id: 'session-restored',
				name: 'Session Restored',
				agentId: 'codex',
				stateMutex: {
					getSnapshot: () => ({state: 'idle'}),
				},
				process: {
					write: vi.fn(),
				},
			}) as never,
		);
		mockedSessionManager.setSessionActive.mockReset();
		mockedSessionManager.getSession.mockReset();
		mockedSessionManager.getSession.mockReturnValue(undefined);
		mockLoadPromptTemplatesByScope.mockReturnValue([
			{
				name: 'Begin Work on Task',
				path: '/tmp/Begin Work on Task.md',
				content: 'Work on {{task.id}}: {{task.title}}',
				source: 'global',
			},
		]);
	});

	it('rehydrates persisted live sessions with stable IDs', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
					setSessionActive: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockSessionStoreQuerySessions.mockReturnValue([
			{
				id: 'session-recover-1',
				agentProfileId: 'codex',
				agentProfileName: 'Codex',
				agentType: 'codex',
				agentOptions: {model: 'gpt-5'},
				agentSessionId: 'rollout-123',
				agentSessionPath: '/tmp/rollout-123.jsonl',
				worktreePath: '/repo/.worktrees/feat-recover',
				branchName: 'feat-recover',
				projectPath: '/repo',
				tdTaskId: null,
				tdSessionId: null,
				sessionName: 'Recovered Session',
				contentPreview: null,
				intent: 'manual',
				createdAt: 1_720_000_000,
				endedAt: null,
			},
		]);

		await (
			apiServer as unknown as {rehydratePersistedSessions: () => Promise<void>}
		).rehydratePersistedSessions();

		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		expect(call?.[0]).toBe('/repo/.worktrees/feat-recover');
		expect(call?.[8]).toEqual(
			expect.objectContaining({sessionIdOverride: 'session-recover-1'}),
		);
		expect(mockedSessionManager.setSessionActive).toHaveBeenCalledWith(
			'session-recover-1',
			true,
		);
	});

	it('restarts only the requested session via /api/session/restart', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
					setSessionActive: ReturnType<typeof vi.fn>;
					getSession: ReturnType<typeof vi.fn>;
					destroySession: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		const record = {
			id: 'session-restart-1',
			agentProfileId: 'codex',
			agentProfileName: 'Codex',
			agentType: 'codex',
			agentOptions: {model: 'gpt-5'},
			agentSessionId: 'rollout-abc',
			agentSessionPath: '/tmp/rollout-abc.jsonl',
			worktreePath: '/repo/.worktrees/feat-restart',
			branchName: 'feat-restart',
			projectPath: '/repo',
			tdTaskId: 'td-123',
			tdSessionId: 'ses_123456',
			sessionName: 'Restart Me',
			contentPreview: null,
			intent: 'work',
			createdAt: 1_720_000_100,
			endedAt: null,
		};

		mockSessionStoreGetSessionById.mockReturnValue(record);
		mockedSessionManager.getSession.mockReturnValue({
			id: 'session-restart-1',
		});

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/restart',
			headers: {cookie: 'cacd_session=test'},
			payload: {id: 'session-restart-1'},
		});

		expect(response.statusCode).toBe(200);
		expect(mockedSessionManager.destroySession).toHaveBeenCalledWith(
			'session-restart-1',
		);
		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		expect(call?.[8]).toEqual(
			expect.objectContaining({sessionIdOverride: 'session-restart-1'}),
		);
		expect(mockedSessionManager.setSessionActive).toHaveBeenCalledWith(
			'session-restart-1',
			true,
		);
		expect(mockSessionStoreMarkSessionResumed).toHaveBeenCalledWith(
			'session-restart-1',
		);
	});

	it('does not auto-start td task when prompt validation fails with 400', async () => {
		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'cacd_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				promptTemplate: 'Missing Template',
			},
		});

		expect(response.statusCode).toBe(400);
		expect(mockExecFileSync).not.toHaveBeenCalledWith(
			'td',
			expect.arrayContaining(['start']),
			expect.anything(),
		);
	});

	it('does not auto-start td task when task validation fails with 404', async () => {
		mockTdReaderGetIssueWithDetails.mockReturnValue(null);

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'cacd_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				promptTemplate: 'Begin Work on Task',
			},
		});

		expect(response.statusCode).toBe(404);
		expect(mockExecFileSync).not.toHaveBeenCalledWith(
			'td',
			expect.arrayContaining(['start']),
			expect.anything(),
		);
	});

	it('reuses original implementer td session id for task-linked work sessions', async () => {
		mockSessionStoreGetOriginalWorkTdSessionId.mockReturnValue('ses_impl001');
		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Fix cache invalidation',
			description: 'Ensure stale reads are removed',
			status: 'in_progress',
			type: 'task',
			priority: 'P1',
			points: 0,
			labels: '',
			parent_id: '',
			acceptance: 'No stale reads',
			implementer_session: 'ses_impl001',
			reviewer_session: '',
			created_at: '',
			updated_at: '',
			closed_at: null,
			deleted_at: null,
			minor: 0,
			created_branch: '',
			creator_session: '',
			sprint: '',
			defer_until: null,
			due_date: null,
			defer_count: 0,
			children: [],
			handoffs: [],
			files: [],
			comments: [],
		});

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'cacd_session=test'},
			payload: {
				path: '/repo/.worktrees/fix-cache',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'work',
				promptTemplate: 'Begin Work on Task',
			},
		});

		expect(response.statusCode).toBe(200);
		expect(mockSessionStoreGetOriginalWorkTdSessionId).toHaveBeenCalledWith({
			tdTaskId: 'td-abc123',
			projectPath: '/repo',
		});

		const tdStartCall = mockExecFileSync.mock.calls.find(call => {
			return (
				call[0] === 'td' &&
				Array.isArray(call[1]) &&
				(call[1] as string[]).includes('start')
			);
		});
		expect(tdStartCall?.[1]).toEqual(
			expect.arrayContaining(['start', 'td-abc123', '--session', 'ses_impl001']),
		);
		expect(mockSessionStoreCreateSessionRecord).toHaveBeenCalledWith(
			expect.objectContaining({
				tdTaskId: 'td-abc123',
				tdSessionId: 'ses_impl001',
				intent: 'work',
			}),
		);
	});

	it('keeps review sessions on a distinct td session id', async () => {
		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Fix cache invalidation',
			description: 'Ensure stale reads are removed',
			status: 'in_review',
			type: 'task',
			priority: 'P1',
			points: 0,
			labels: '',
			parent_id: '',
			acceptance: 'No stale reads',
			implementer_session: 'ses_impl001',
			reviewer_session: 'ses_reviewer_a',
			created_at: '',
			updated_at: '',
			closed_at: null,
			deleted_at: null,
			minor: 0,
			created_branch: '',
			creator_session: '',
			sprint: '',
			defer_until: null,
			due_date: null,
			defer_count: 0,
			children: [],
			handoffs: [],
			files: [],
			comments: [],
		});

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'cacd_session=test'},
			payload: {
				path: '/repo/.worktrees/review-cache',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'review',
				promptTemplate: 'Begin Work on Task',
			},
		});

		expect(response.statusCode).toBe(200);
		expect(mockSessionStoreGetOriginalWorkTdSessionId).not.toHaveBeenCalled();

		const tdStartCall = mockExecFileSync.mock.calls.find(call => {
			return (
				call[0] === 'td' &&
				Array.isArray(call[1]) &&
				(call[1] as string[]).includes('start')
			);
		});
		const tdArgs = (tdStartCall?.[1] || []) as string[];
		const sessionFlagIndex = tdArgs.indexOf('--session');
		const reviewSessionId =
			sessionFlagIndex >= 0 ? tdArgs[sessionFlagIndex + 1] : undefined;

		expect(reviewSessionId).toBeDefined();
		expect(reviewSessionId).toMatch(/^ses_/);
		expect(reviewSessionId).not.toBe('ses_impl001');
		expect(mockSessionStoreCreateSessionRecord).toHaveBeenCalledWith(
			expect.objectContaining({
				tdTaskId: 'td-abc123',
				tdSessionId: reviewSessionId,
				intent: 'review',
			}),
		);
	});

	it('preserves worktree hook warnings at top-level and nested response fields', async () => {
		mockCreateWorktreeEffect.mockReturnValue(
			Effect.succeed({
				path: '/repo/.worktrees/feat-warning',
				branch: 'feat-warning',
				isMainWorktree: false,
				hasSession: false,
				warnings: ['setup hook warning'],
			}),
		);

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/worktree/create',
			headers: {cookie: 'cacd_session=test'},
			payload: {
				path: '/repo/.worktrees/feat-warning',
				branch: 'feat-warning',
				baseBranch: 'main',
				copySessionData: false,
				copyClaudeDirectory: false,
			},
		});

		expect(response.statusCode).toBe(200);
		const payload = JSON.parse(response.body) as {
			success: boolean;
			warnings?: string[];
			worktree?: {warnings?: string[]};
		};
		expect(payload.success).toBe(true);
		expect(payload.warnings).toEqual(['setup hook warning']);
		expect(payload.worktree?.warnings).toEqual(['setup hook warning']);
	});

	// --- Multi-manager session visibility (td-ccdeab regression) ---

	const makeFakeSession = (
		id: string,
		worktreePath: string,
		agentId?: string,
	) => ({
		id,
		name: undefined,
		worktreePath,
		isActive: true,
		agentId,
		process: {pid: 12345},
		stateMutex: {
			getSnapshot: () => ({
				state: 'idle',
				autoApprovalFailed: false,
				autoApprovalReason: undefined,
			}),
		},
	});

	it('/api/sessions returns sessions from all project managers, not just the active one', async () => {
		mockGetAllActiveSessions.mockReturnValue([
			makeFakeSession('ses-project-a', '/repo-a/.worktrees/feat-1', 'claude'),
			makeFakeSession('ses-project-b', '/repo-b/.worktrees/feat-2', 'codex'),
			makeFakeSession('ses-global', '/repo/.worktrees/main'),
		]);

		const response = await apiServer.app.inject({
			method: 'GET',
			url: '/api/sessions',
			headers: {cookie: 'cacd_session=test'},
		});

		expect(response.statusCode).toBe(200);
		const sessions = JSON.parse(response.body) as Array<{
			id: string;
			path: string;
		}>;
		expect(sessions).toHaveLength(3);
		expect(sessions.map(s => s.id)).toEqual(
			expect.arrayContaining(['ses-project-a', 'ses-project-b', 'ses-global']),
		);
	});

	it('/api/sessions returns empty list when no sessions exist across any manager', async () => {
		mockGetAllActiveSessions.mockReturnValue([]);

		const response = await apiServer.app.inject({
			method: 'GET',
			url: '/api/sessions',
			headers: {cookie: 'cacd_session=test'},
		});

		expect(response.statusCode).toBe(200);
		const sessions = JSON.parse(response.body) as unknown[];
		expect(sessions).toHaveLength(0);
	});

	it('/api/worktrees hasSession reflects sessions from all managers', async () => {
		const {projectManager} = await import('./projectManager.js');
		const mockedPM = projectManager as unknown as {
			getProjects: ReturnType<typeof vi.fn>;
			instance: {
				getWorktreeService: ReturnType<typeof vi.fn>;
			};
		};

		const mockWorktreeService = {
			getWorktreesEffect: vi.fn(() =>
				Effect.succeed([
					{
						path: '/repo/main',
						branch: 'main',
						isMainWorktree: true,
						hasSession: false,
					},
					{
						path: '/repo/.worktrees/feat-x',
						branch: 'feat-x',
						isMainWorktree: false,
						hasSession: false,
					},
				]),
			),
		};

		mockedPM.getProjects.mockReturnValue([
			{path: '/repo', name: 'Repo', isValid: true},
		]);
		mockedPM.instance.getWorktreeService = vi.fn(() => mockWorktreeService);

		// Session exists in a non-selected project manager for feat-x worktree
		mockGetAllActiveSessions.mockReturnValue([
			makeFakeSession('ses-other-project', '/repo/.worktrees/feat-x'),
		]);

		const response = await apiServer.app.inject({
			method: 'GET',
			url: '/api/worktrees',
			headers: {cookie: 'cacd_session=test'},
		});

		expect(response.statusCode).toBe(200);
		const worktrees = JSON.parse(response.body) as Array<{
			path: string;
			hasSession: boolean;
		}>;

		const mainWt = worktrees.find(w => w.path === '/repo/main');
		const featWt = worktrees.find(w => w.path === '/repo/.worktrees/feat-x');

		expect(mainWt?.hasSession).toBe(false);
		expect(featWt?.hasSession).toBe(true);
	});
});
