import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {Effect} from 'effect';
import {coreService} from './coreService.js';
import type {FSWatcher} from 'node:fs';

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
const mockSessionStoreGetOriginalWorkTdSessionId = vi.fn(
	() => null as string | null,
);
const mockWatch = vi.fn<(...args: unknown[]) => unknown>();
const mockCleanupStartupScriptsInWorktree = vi.fn<
	(worktreePath: string, maxAgeMs: number, now?: number) => Promise<number>
>(() => Promise.resolve(0));
const tempDirs: string[] = [];

function makeTempTranscript(fileName: string, content: string): string {
	const {mkdtempSync, writeFileSync} = require('node:fs') as typeof import('node:fs');
	const {tmpdir} = require('node:os') as typeof import('node:os');
	const path = require('node:path') as typeof import('node:path');
	const dir = mkdtempSync(path.join(tmpdir(), 'argusdev-api-'));
	tempDirs.push(dir);
	const filePath = path.join(dir, fileName);
	writeFileSync(filePath, content, 'utf8');
	return filePath;
}

vi.mock('../utils/startupScript.js', async importOriginal => {
	const actual =
		await importOriginal<typeof import('../utils/startupScript.js')>();
	return {
		...actual,
		cleanupStartupScriptsInWorktree: mockCleanupStartupScriptsInWorktree,
	};
});

vi.mock('child_process', async importOriginal => {
	const actual = await importOriginal<typeof import('child_process')>();
	return {
		...actual,
		execFileSync: mockExecFileSync,
	};
});

vi.mock('fs', async importOriginal => {
	const actual = await importOriginal<typeof import('fs')>();
	return {
		...actual,
		watch: mockWatch,
	};
});

vi.mock('../utils/projectConfig.js', () => ({
	loadProjectConfig: vi.fn(() => ({td: {enabled: true, autoStart: true}})),
	getProjectConfigPath: vi.fn(() => '/repo/.argusdev/config.json'),
	saveProjectConfig: vi.fn(() => '/repo/.argusdev/config.json'),
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
		getUpdateCheck: vi.fn(() => undefined),
		setUpdateCheck: vi.fn(),
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
		getPort: vi.fn(() => undefined),
		isAutoApprovalEnabled: vi.fn(() => false),
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
			createSessionId: vi.fn(() => 'session-mock-id'),
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

type PendingTdPromptInjection = {
	prompt: string;
	taskId?: string;
	timeout: ReturnType<typeof setTimeout>;
};

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
	let sessionProcessWriteMock: ReturnType<typeof vi.fn>;

	const getPendingTdPromptInjections = (): Map<
		string,
		PendingTdPromptInjection
	> => {
		const serverWithQueue = apiServer as unknown as {
			pendingTdPromptInjections?: Map<string, PendingTdPromptInjection>;
		};
		return serverWithQueue.pendingTdPromptInjections || new Map();
	};

	const clearPendingTdPromptInjections = () => {
		for (const value of getPendingTdPromptInjections().values()) {
			clearTimeout(value.timeout);
		}
		getPendingTdPromptInjections().clear();
	};

	const mockAgentConfig = async (agent: {
		id: string;
		name: string;
		kind: 'agent';
		command: string;
		options: [];
		promptArg?: string;
		enabled: boolean;
	}) => {
		const {configurationManager} = await import('./configurationManager.js');
		vi.mocked(configurationManager.getAgentById).mockReturnValue(agent);
	};

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
		clearPendingTdPromptInjections();
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
		mockCleanupStartupScriptsInWorktree.mockReset();
		for (const dir of tempDirs.splice(0)) {
			const {rmSync} = require('node:fs') as typeof import('node:fs');
			rmSync(dir, {recursive: true, force: true});
		}
		mockSessionStoreQuerySessions.mockReturnValue([]);
		mockSessionStoreGetSessionById.mockReturnValue(null);
		mockSessionStoreCountSessions.mockReturnValue(0);
		mockSessionStoreGetOriginalWorkTdSessionId.mockReturnValue(null);
		mockedSessionManager.createSessionWithAgentEffect.mockReset();
		sessionProcessWriteMock = vi.fn();
		mockedSessionManager.createSessionWithAgentEffect.mockReturnValue(
			Effect.succeed({
				id: 'session-restored',
				name: 'Session Restored',
				agentId: 'codex',
				stateMutex: {
					getSnapshot: () => ({state: 'idle'}),
				},
				process: {
					write: sessionProcessWriteMock,
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

	it('cleans up startup launcher scripts on first startup', async () => {
		vi.mocked(coreService.getState).mockReturnValue({
			selectedProject: null,
			activeSession: null,
			worktrees: [
				{
					path: '/repo/.worktrees/live-from-state',
					isMainWorktree: false,
					hasSession: false,
				},
			],
		});

		mockSessionStoreQuerySessions.mockReturnValue([
			{worktreePath: '/repo/.worktrees/live-from-store'},
		]);

		const startedApiServer = apiServer as unknown as {
			start: (
				port: number,
				host: string,
				devMode: boolean,
			) => Promise<{
				address: string;
				port: number;
			}>;
		};
		const result = await startedApiServer.start(0, '127.0.0.1', true);
		expect(result.address).toContain('127.0.0.1');

		expect(mockCleanupStartupScriptsInWorktree).toHaveBeenCalledTimes(2);
		expect(mockCleanupStartupScriptsInWorktree).toHaveBeenCalledWith(
			'/repo/.worktrees/live-from-state',
			expect.any(Number),
		);
		expect(mockCleanupStartupScriptsInWorktree).toHaveBeenCalledWith(
			'/repo/.worktrees/live-from-store',
			expect.any(Number),
		);
	});

	it('deduplicates worktree paths before startup cleanup', async () => {
		const loaded = '/repo/.worktrees/shared';
		vi.mocked(coreService.getState).mockReturnValue({
			selectedProject: null,
			activeSession: null,
			worktrees: [
				{
					path: loaded,
					isMainWorktree: false,
					hasSession: false,
				},
			],
		});

		mockSessionStoreQuerySessions.mockReturnValue([
			{worktreePath: loaded},
			{worktreePath: loaded},
		]);

		await vi.resetModules();
		const freshApiModule = await import('./apiServer.js');
		const freshApiServer = freshApiModule.apiServer as {
			start: (
				port: number,
				host: string,
				devMode: boolean,
			) => Promise<{address: string; port: number}>;
			stop: () => Promise<void>;
		};

		try {
			await freshApiServer.start(0, '127.0.0.1', true);
			expect(mockCleanupStartupScriptsInWorktree).toHaveBeenCalledTimes(2);
			expect(mockCleanupStartupScriptsInWorktree).toHaveBeenCalledWith(
				loaded,
				expect.any(Number),
			);
			expect(mockCleanupStartupScriptsInWorktree).toHaveBeenCalledWith(
				loaded,
				expect.any(Number),
			);
		} finally {
			await freshApiServer.stop();
		}
	});

	it('continues startup cleanup when sessionStore lookup fails', async () => {
		const loaded = '/repo/.worktrees/failing-store';
		vi.mocked(coreService.getState).mockReturnValue({
			selectedProject: null,
			activeSession: null,
			worktrees: [
				{
					path: loaded,
					isMainWorktree: false,
					hasSession: false,
				},
			],
		});

		mockSessionStoreQuerySessions.mockImplementation(() => {
			throw new Error('temp db locked');
		});

		await vi.resetModules();
		const freshApiModule = await import('./apiServer.js');
		const freshApiServer = freshApiModule.apiServer as {
			start: (
				port: number,
				host: string,
				devMode: boolean,
			) => Promise<{address: string; port: number}>;
			stop: () => Promise<void>;
		};

		try {
			await freshApiServer.start(0, '127.0.0.1', true);
			expect(mockCleanupStartupScriptsInWorktree).toHaveBeenCalled();
			expect(mockCleanupStartupScriptsInWorktree).toHaveBeenCalledWith(
				loaded,
				expect.any(Number),
			);
		} finally {
			await freshApiServer.stop();
		}
	});

	it('throws a clear error when a configured port is already in use and fallback is disabled', async () => {
		await vi.resetModules();
		const freshApiModule = await import('./apiServer.js');
		const freshApiServer = freshApiModule.apiServer as unknown as {
			start: (
				port: number,
				host: string,
				devMode: boolean,
				allowRandomPortFallback?: boolean,
			) => Promise<{address: string; port: number}>;
			app: {
				listen: ReturnType<typeof vi.fn>;
			};
		};

		const addressInUse = new Error('address in use') as NodeJS.ErrnoException;
		addressInUse.code = 'EADDRINUSE';
		const listenSpy = vi
			.spyOn(freshApiServer.app, 'listen')
			.mockRejectedValue(addressInUse);

		expect.assertions(2);
		await expect(
			freshApiServer.start(3000, '127.0.0.1', false, false),
		).rejects.toThrow(
			'Port 3000 is already in use. Start with a different port using --port.',
		);
		expect(listenSpy).toHaveBeenCalledTimes(1);
	});

	it('retries with a random port when fallback is enabled and address is in use', async () => {
		await vi.resetModules();
		const freshApiModule = await import('./apiServer.js');
		const freshApiServer = freshApiModule.apiServer as unknown as {
			start: (
				port: number,
				host: string,
				devMode: boolean,
				allowRandomPortFallback?: boolean,
			) => Promise<{address: string; port: number}>;
			stop: () => Promise<void>;
			app: {
				listen: ReturnType<typeof vi.fn>;
			};
		};

		const addressInUse = new Error('address in use') as NodeJS.ErrnoException;
		addressInUse.code = 'EADDRINUSE';
		const listenSpy = vi
			.spyOn(freshApiServer.app, 'listen')
			.mockRejectedValueOnce(addressInUse)
			.mockResolvedValueOnce('http://127.0.0.1:41234');

		try {
			const result = await freshApiServer.start(3000, '127.0.0.1', false, true);
			expect(listenSpy).toHaveBeenCalledTimes(2);
			const firstCall = listenSpy.mock.calls[0]?.[0] as {port: number};
			const secondCall = listenSpy.mock.calls[1]?.[0] as {port: number};
			expect(firstCall?.port).toBe(3000);
			expect(secondCall?.port).not.toBe(3000);
			expect(result.port).toBe(secondCall?.port);
		} finally {
			await freshApiServer.stop();
		}
	});

	it('throws a clear error for permission denied even when fallback is enabled', async () => {
		await vi.resetModules();
		const freshApiModule = await import('./apiServer.js');
		const freshApiServer = freshApiModule.apiServer as unknown as {
			start: (
				port: number,
				host: string,
				devMode: boolean,
				allowRandomPortFallback?: boolean,
			) => Promise<{address: string; port: number}>;
			app: {
				listen: ReturnType<typeof vi.fn>;
			};
		};

		const permissionError = new Error(
			'permission denied',
		) as NodeJS.ErrnoException;
		permissionError.code = 'EACCES';
		const listenSpy = vi
			.spyOn(freshApiServer.app, 'listen')
			.mockRejectedValue(permissionError);

		expect.assertions(2);
		await expect(
			freshApiServer.start(80, '127.0.0.1', false, true),
		).rejects.toThrow(
			'Cannot bind to port 80: permission denied. Try a higher port or allow permission for this operation.',
		);
		expect(listenSpy).toHaveBeenCalledTimes(1);
	});

	it('runs startup launcher cleanup on interval', async () => {
		const setIntervalCalls: Array<{
			callback: (...args: unknown[]) => unknown;
			delay: number;
		}> = [];

		const setIntervalSpy = vi
			.spyOn(global, 'setInterval')
			.mockImplementation((callback, delay) => {
				setIntervalCalls.push({
					callback: callback as (...args: unknown[]) => unknown,
					delay: typeof delay === 'number' ? delay : 0,
				});
				return 1 as unknown as ReturnType<typeof setInterval>;
			});

		try {
			vi.mocked(coreService.getState).mockReturnValue({
				selectedProject: null,
				activeSession: null,
				worktrees: [
					{
						path: '/repo/.worktrees/live-from-state',
						isMainWorktree: false,
						hasSession: false,
					},
				],
			});

			mockSessionStoreQuerySessions.mockReturnValue([
				{worktreePath: '/repo/.worktrees/live-from-store'},
			]);

			await vi.resetModules();
			await import('./apiServer.js');

			const intervalCallback = setIntervalCalls.find(item => {
				if (item.delay !== 60 * 60 * 1000) {
					return false;
				}

				return item.callback.toString().includes('cleanupStartupScripts');
			})?.callback;
			expect(typeof intervalCallback).toBe('function');

			intervalCallback?.();
			await Promise.resolve();
			expect(mockCleanupStartupScriptsInWorktree).toHaveBeenCalled();
		} finally {
			setIntervalSpy.mockRestore();
		}
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
			headers: {cookie: 'argusdev_session=test'},
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
		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Test Task',
			description: 'Test description',
			status: 'open',
			priority: 'P2',
			acceptance: '',
			labels: '',
			parent_id: '',
			type: 'task',
			points: 0,
			implementer_session: '',
			reviewer_session: '',
			created_at: '2024-01-01',
			updated_at: '2024-01-01',
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
			rejectionReason: null,
		});

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
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
			headers: {cookie: 'argusdev_session=test'},
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
			rejectionReason: null,
		});

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
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
			expect.arrayContaining([
				'start',
				'td-abc123',
				'--session',
				'ses_impl001',
			]),
		);
		expect(mockSessionStoreCreateSessionRecord).toHaveBeenCalledWith(
			expect.objectContaining({
				tdTaskId: 'td-abc123',
				tdSessionId: 'ses_impl001',
				intent: 'work',
			}),
		);
	});

	it('uses fix intent for task-linked fix sessions and reuses the original implementer td session', async () => {
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
			rejectionReason: null,
		});

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
			payload: {
				path: '/repo/.worktrees/fix-cache',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'fix',
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
			expect.arrayContaining([
				'start',
				'td-abc123',
				'--session',
				'ses_impl001',
			]),
		);
		expect(mockSessionStoreCreateSessionRecord).toHaveBeenCalledWith(
			expect.objectContaining({
				tdTaskId: 'td-abc123',
				tdSessionId: 'ses_impl001',
				intent: 'fix',
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
			rejectionReason: null,
		});

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
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

	it('auto-selects Fix Rejected Work prompt for work intent on rejected in_progress tasks', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Rejected Task',
			description: 'Test description',
			status: 'in_progress',
			priority: 'P1',
			acceptance: 'Acceptance criteria',
			labels: '',
			parent_id: '',
			type: 'task',
			points: 0,
			implementer_session: '',
			reviewer_session: '',
			created_at: '2024-01-01',
			updated_at: '2024-01-01',
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
			rejectionReason: 'Missing test coverage for edge cases.',
		});
		mockLoadPromptTemplatesByScope.mockReturnValue([
			{
				name: 'Begin Work on Task',
				path: '/tmp/Begin Work on Task.md',
				content: 'Work on {{task.id}}: {{task.title}}',
				source: 'global',
			},
			{
				name: 'Fix Rejected Work',
				path: '/tmp/Fix Rejected Work.md',
				content:
					'Task {{task.id}} was rejected: {{task.rejection_reason}}\n\nFix the issues.',
				source: 'global',
			},
		]);

		await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'work',
			},
		});

		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		const options = call?.[8] as {initialPrompt?: string} | undefined;
		expect(options?.initialPrompt).toBeDefined();
		expect(options?.initialPrompt).toContain('was rejected');
		expect(options?.initialPrompt).toContain('Missing test coverage');
	});

	it('does NOT auto-select Fix prompt for review intent on rejected task', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Rejected Task',
			description: 'Test description',
			status: 'in_progress',
			priority: 'P1',
			acceptance: 'Acceptance criteria',
			labels: '',
			parent_id: '',
			type: 'task',
			points: 0,
			implementer_session: '',
			reviewer_session: '',
			created_at: '2024-01-01',
			updated_at: '2024-01-01',
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
			rejectionReason: 'Missing test coverage for edge cases.',
		});
		mockLoadPromptTemplatesByScope.mockReturnValue([
			{
				name: 'Begin Work on Task',
				path: '/tmp/Begin Work on Task.md',
				content: 'Work on {{task.id}}: {{task.title}}',
				source: 'global',
			},
			{
				name: 'Fix Rejected Work',
				path: '/tmp/Fix Rejected Work.md',
				content:
					'Task {{task.id}} was rejected: {{task.rejection_reason}}\n\nFix the issues.',
				source: 'global',
			},
		]);

		await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'review',
			},
		});

		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		const options = call?.[8] as {initialPrompt?: string} | undefined;
		expect(options?.initialPrompt).toBeDefined();
		expect(options?.initialPrompt).not.toContain('was rejected');
		expect(options?.initialPrompt).toContain('td-abc123');
	});

	it('falls back to Begin Work on Task when Fix Rejected Work template missing', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Rejected Task',
			description: 'Test description',
			status: 'in_progress',
			priority: 'P1',
			acceptance: 'Acceptance criteria',
			labels: '',
			parent_id: '',
			type: 'task',
			points: 0,
			implementer_session: '',
			reviewer_session: '',
			created_at: '2024-01-01',
			updated_at: '2024-01-01',
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
			rejectionReason: 'Missing test coverage.',
		});
		mockLoadPromptTemplatesByScope.mockReturnValue([
			{
				name: 'Begin Work on Task',
				path: '/tmp/Begin Work on Task.md',
				content: 'Work on {{task.id}}: {{task.title}}',
				source: 'global',
			},
		]);

		await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'work',
			},
		});

		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		const options = call?.[8] as {initialPrompt?: string} | undefined;
		expect(options?.initialPrompt).toBeDefined();
		expect(options?.initialPrompt).toContain('td-abc123');
		expect(options?.initialPrompt).not.toContain('was rejected');
	});

	it('uses Begin Work on Task for normal in_progress tasks without rejection', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Normal Task',
			description: 'Test description',
			status: 'in_progress',
			priority: 'P1',
			acceptance: 'Acceptance criteria',
			labels: '',
			parent_id: '',
			type: 'task',
			points: 0,
			implementer_session: '',
			reviewer_session: '',
			created_at: '2024-01-01',
			updated_at: '2024-01-01',
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
			rejectionReason: null,
		});

		await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'work',
			},
		});

		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		const options = call?.[8] as {initialPrompt?: string} | undefined;
		expect(options?.initialPrompt).toBeDefined();
		expect(options?.initialPrompt).toContain('td-abc123');
		expect(options?.initialPrompt).not.toContain('was rejected');
	});

	it('renders latest handoff context in task prompt templates', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Task with handoff',
			description: 'Test description',
			status: 'in_progress',
			priority: 'P1',
			acceptance: 'Acceptance criteria',
			labels: 'backend,api',
			parent_id: '',
			type: 'bug',
			points: 0,
			implementer_session: '',
			reviewer_session: '',
			created_at: '2024-01-01',
			updated_at: '2024-01-01',
			closed_at: null,
			deleted_at: null,
			minor: 0,
			created_branch: 'feature/add-auth',
			creator_session: '',
			sprint: '',
			defer_until: null,
			due_date: null,
			defer_count: 0,
			children: [],
			handoffs: [
				{
					id: 'h2',
					issueId: 'td-abc123',
					sessionId: 'ses-2',
					done: ['Add auth helper', 'Write tests'],
					remaining: ['Handle timeout edge case'],
					decisions: ['Use JWT'],
					uncertain: ['Exact token expiry'],
					timestamp: '2024-01-01T00:00:00Z',
				},
				{
					id: 'h1',
					issueId: 'td-abc123',
					sessionId: 'ses-1',
					done: ['Old item'],
					remaining: ['Old remaining'],
					decisions: ['Old decision'],
					uncertain: ['Old uncertain'],
					timestamp: '2023-12-31T00:00:00Z',
				},
			],
			files: [],
			comments: [],
			rejectionReason: null,
		});
		mockLoadPromptTemplatesByScope.mockReturnValue([
			{
				name: 'Begin Work on Task',
				path: '/tmp/Begin Work on Task.md',
				content:
					'{{task.handoff.done}}\n{{task.handoff.remaining}}\n{{task.handoff.decisions}}\n{{task.handoff.uncertain}}\n{{task.type}}|{{task.branch}}|{{task.labels}}',
				source: 'global',
			},
		]);

		await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'work',
			},
		});

		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		const options = call?.[8] as {initialPrompt?: string} | undefined;
		expect(options?.initialPrompt).toBeDefined();
		expect(options?.initialPrompt).toContain('Add auth helper\nWrite tests');
		expect(options?.initialPrompt).toContain('Handle timeout edge case');
		expect(options?.initialPrompt).toContain('Use JWT');
		expect(options?.initialPrompt).toContain('Exact token expiry');
		expect(options?.initialPrompt).toContain(
			'bug|feature/add-auth|backend,api',
		);
	});

	it('renders empty handoff fields as empty strings in templates', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Task with no handoff',
			description: 'Test description',
			status: 'in_progress',
			priority: 'P1',
			acceptance: 'Acceptance criteria',
			labels: '',
			parent_id: '',
			type: 'task',
			points: 0,
			implementer_session: '',
			reviewer_session: '',
			created_at: '2024-01-01',
			updated_at: '2024-01-01',
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
			rejectionReason: null,
		});
		mockLoadPromptTemplatesByScope.mockReturnValue([
			{
				name: 'Begin Work on Task',
				path: '/tmp/Begin Work on Task.md',
				content: 'Done items:\n{{task.handoff.done}}',
				source: 'global',
			},
		]);

		await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'work',
			},
		});

		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		const options = call?.[8] as {initialPrompt?: string} | undefined;
		expect(options?.initialPrompt).toContain('Done items:');
		expect(options?.initialPrompt).not.toContain('undefined');
	});

	it('uses CLI arg startup prompt delivery and skips PTY queue for Codex', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Normal Task',
			description: 'Test description',
			status: 'in_progress',
			priority: 'P1',
			acceptance: 'Acceptance criteria',
			labels: '',
			parent_id: '',
			type: 'task',
			points: 0,
			implementer_session: '',
			reviewer_session: '',
			created_at: '2024-01-01',
			updated_at: '2024-01-01',
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
			rejectionReason: null,
		});
		await mockAgentConfig({
			id: 'codex',
			name: 'Codex',
			kind: 'agent',
			command: 'codex',
			options: [],
			enabled: true,
		});

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'work',
			},
		});

		expect(response.statusCode).toBe(200);
		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		const options = call?.[8] as {
			initialPrompt?: string;
			promptArg?: string;
		};
		expect(options?.initialPrompt).toBeDefined();
		expect(options?.initialPrompt).toContain('td-abc123');
		expect(options?.promptArg).toBeUndefined();
		expect(sessionProcessWriteMock).not.toHaveBeenCalled();
		expect(getPendingTdPromptInjections().has('session-restored')).toBe(false);
	});

	it('queues startup prompt via PTY when startup prompt cannot be passed via CLI arg', async () => {
		const mockedSessionManager = (
			coreService as unknown as {
				sessionManager: {
					createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
				};
			}
		).sessionManager;

		mockTdReaderGetIssueWithDetails.mockReturnValue({
			id: 'td-abc123',
			title: 'Normal Task',
			description: 'Test description',
			status: 'in_progress',
			priority: 'P1',
			acceptance: 'Acceptance criteria',
			labels: '',
			parent_id: '',
			type: 'task',
			points: 0,
			implementer_session: '',
			reviewer_session: '',
			created_at: '2024-01-01',
			updated_at: '2024-01-01',
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
			rejectionReason: null,
		});

		await mockAgentConfig({
			id: 'codex',
			name: 'Codex',
			kind: 'agent',
			command: 'codex',
			options: [],
			promptArg: 'none',
			enabled: true,
		});

		const response = await apiServer.app.inject({
			method: 'POST',
			url: '/api/session/create-with-agent',
			headers: {cookie: 'argusdev_session=test'},
			payload: {
				path: '/repo/.worktrees/feat',
				agentId: 'codex',
				options: {},
				tdTaskId: 'td-abc123',
				intent: 'work',
			},
		});

		expect(response.statusCode).toBe(200);
		expect(
			mockedSessionManager.createSessionWithAgentEffect,
		).toHaveBeenCalled();
		const call =
			mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
		const options = call?.[8] as {
			initialPrompt?: string;
			promptArg?: string;
		};
		expect(options?.initialPrompt).toBeUndefined();
		expect(options?.promptArg).toBe('none');
		expect(sessionProcessWriteMock).toHaveBeenCalledWith(
			expect.stringContaining('td-abc123'),
		);
		const pending = getPendingTdPromptInjections();
		expect(pending.has('session-restored')).toBe(false);
	});

	it.each(['claude', 'pi', 'gemini'] as const)(
		'uses CLI-based startup delivery for %s without PTY queued prompt',
		async agentId => {
			const mockedSessionManager = (
				coreService as unknown as {
					sessionManager: {
						createSessionWithAgentEffect: ReturnType<typeof vi.fn>;
					};
				}
			).sessionManager;

			mockTdReaderGetIssueWithDetails.mockReturnValue({
				id: 'td-abc123',
				title: 'Agent Prompt Task',
				description: 'Test description',
				status: 'in_progress',
				priority: 'P1',
				acceptance: 'Acceptance criteria',
				labels: '',
				parent_id: '',
				type: 'task',
				points: 0,
				implementer_session: '',
				reviewer_session: '',
				created_at: '2024-01-01',
				updated_at: '2024-01-01',
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
				rejectionReason: null,
			});
			await mockAgentConfig({
				id: agentId,
				name: agentId,
				kind: 'agent',
				command: agentId,
				options: [],
				enabled: true,
			});

			const response = await apiServer.app.inject({
				method: 'POST',
				url: '/api/session/create-with-agent',
				headers: {cookie: 'argusdev_session=test'},
				payload: {
					path: '/repo/.worktrees/feat',
					agentId,
					options: {},
					tdTaskId: 'td-abc123',
					intent: 'work',
				},
			});

			expect(response.statusCode).toBe(200);
			expect(
				mockedSessionManager.createSessionWithAgentEffect,
			).toHaveBeenCalled();
			const call =
				mockedSessionManager.createSessionWithAgentEffect.mock.calls[0];
			const options = call?.[8] as {
				initialPrompt?: string;
				promptArg?: string;
			};
			expect(options?.initialPrompt).toBeDefined();
			expect(options?.initialPrompt).toContain('td-abc123');
			expect(options?.promptArg).toBeUndefined();
			expect(sessionProcessWriteMock).not.toHaveBeenCalled();
			expect(getPendingTdPromptInjections().has('session-restored')).toBe(
				false,
			);
		},
	);

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
			headers: {cookie: 'argusdev_session=test'},
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
			headers: {cookie: 'argusdev_session=test'},
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
			headers: {cookie: 'argusdev_session=test'},
		});

		expect(response.statusCode).toBe(200);
		const sessions = JSON.parse(response.body) as unknown[];
		expect(sessions).toHaveLength(0);
	});

	it('/api/conversations/:sessionId/messages falls back to plain-text parsing for unknown agents', async () => {
		const transcriptPath = makeTempTranscript(
			'unknown.jsonl',
			[
				'plain text transcript line',
				JSON.stringify({
					timestamp: '2026-04-14T10:00:10.000Z',
					type: 'entry',
					message: 'plain text fallback line',
				}),
			].join('\n'),
		);

		mockSessionStoreGetSessionById.mockReturnValue({
			id: 'session-unknown',
			agentProfileId: 'missing-agent',
			agentProfileName: 'Mystery Agent',
			agentType: 'mystery',
			agentOptions: {},
			agentSessionId: 'mystery-1',
			agentSessionPath: transcriptPath,
			worktreePath: '/repo/.worktrees/mystery',
			branchName: 'feat-mystery',
			projectPath: '/repo',
			tdTaskId: null,
			tdSessionId: null,
			sessionName: 'Unknown session',
			contentPreview: null,
			intent: 'work',
			createdAt: 1_713_088_000,
			endedAt: null,
		});

		const response = await apiServer.app.inject({
			method: 'GET',
			url: '/api/conversations/session-unknown/messages',
			headers: {cookie: 'argusdev_session=test'},
		});

		expect(response.statusCode).toBe(200);
		const payload = JSON.parse(response.body) as {
			metadata: {messageCount?: number};
			messages: Array<{content: string}>;
			error?: string;
		};
		expect(payload.error).toBeUndefined();
		expect(payload.metadata.messageCount).toBe(2);
		expect(payload.messages[0]?.content).toBe('plain text transcript line');
		expect(payload.messages[1]?.content).toBe('plain text fallback line');
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
			headers: {cookie: 'argusdev_session=test'},
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

describe('APIServer TD issues.db watcher', () => {
	let apiServer: import('./apiServer.js').APIServer;
	let mockWatcher: {
		close: ReturnType<typeof vi.fn>;
		on: ReturnType<typeof vi.fn>;
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();

		const {coreService: mockedCoreService} = await import('./coreService.js');
		const {tdService: mockedTdService} = await import('./tdService.js');
		mockedCoreService.getSelectedProject = vi.fn(() => ({
			path: '/repo',
			name: 'repo',
			relativePath: '/repo',
			isValid: true,
		}));
		mockedTdService.resolveProjectState = vi.fn(() => ({
			enabled: true,
			initialized: true,
			binaryAvailable: true,
			todosDir: '/repo/.todos',
			dbPath: '/repo/.todos/issues.db',
			tdRoot: '/repo',
		}));

		mockWatcher = {
			close: vi.fn(),
			on: vi.fn(() => mockWatcher),
		};

		mockWatch.mockReset();
		mockWatch.mockReturnValue(mockWatcher as unknown as FSWatcher);

		const apiServerModule = await import('./apiServer.js');
		apiServer = apiServerModule.apiServer;

		const apiServerInternal = apiServer as unknown as {
			setupPromise: Promise<void>;
		};
		await apiServerInternal.setupPromise;
	});

	afterEach(() => {
		mockWatch.mockReset();
	});

	it('does nothing when no project is selected', async () => {
		const {coreService: mockedCoreService} = await import('./coreService.js');
		const internal = apiServer as unknown as {
			setupTdDbWatcher: () => void;
		};
		mockedCoreService.getSelectedProject = vi.fn(() => null);
		const callsBefore = mockWatch.mock.calls.length;
		internal.setupTdDbWatcher();
		expect(mockWatch).toHaveBeenCalledTimes(callsBefore);
	});

	it('does nothing when selected project has no issues.db path', async () => {
		const {coreService: mockedCoreService} = await import('./coreService.js');
		const {tdService: mockedTdService} = await import('./tdService.js');
		const internal = apiServer as unknown as {
			setupTdDbWatcher: () => void;
		};
		mockedCoreService.getSelectedProject = vi.fn(() => ({
			path: '/repo',
			name: 'repo',
			relativePath: '/repo',
			isValid: true,
		}));
		mockedTdService.resolveProjectState = vi.fn(() => ({
			enabled: true,
			initialized: true,
			binaryAvailable: true,
			todosDir: '/repo/.todos',
			dbPath: null,
			tdRoot: '/repo',
		}));
		const callsBefore = mockWatch.mock.calls.length;
		internal.setupTdDbWatcher();
		expect(mockWatch).toHaveBeenCalledTimes(callsBefore);
	});

	it('emits td_board_changed when db file changes', async () => {
		const mockEmit = vi.fn();
		const internal = apiServer as unknown as {
			io: {emit: ReturnType<typeof vi.fn>} | undefined;
			setupTdDbWatcher: () => void;
		};
		internal['io'] = {emit: mockEmit};

		const watchCallback = mockWatch.mock.calls[
			mockWatch.mock.calls.length - 1
		]?.[1] as (eventType: string) => void;
		expect(watchCallback).toBeDefined();

		const timeoutCallbacks: Array<() => void> = [];
		const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((
			callback: () => void,
		) => {
			timeoutCallbacks.push(callback);
			return 0 as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout);

		watchCallback('change');
		expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
		expect(timeoutCallbacks).toHaveLength(1);
		timeoutCallbacks[0]?.();
		expect(mockEmit).toHaveBeenCalledWith('td_board_changed');

		setTimeoutSpy.mockRestore();
	});

	it('debounces rapid db change events to one emit', () => {
		const mockEmit = vi.fn();
		const internal = apiServer as unknown as {
			io: {emit: ReturnType<typeof vi.fn>} | undefined;
			setupTdDbWatcher: () => void;
		};
		internal['io'] = {emit: mockEmit};

		const watchCallback = mockWatch.mock.calls[
			mockWatch.mock.calls.length - 1
		]?.[1] as (eventType: string) => void;
		expect(watchCallback).toBeDefined();

		vi.useFakeTimers();
		watchCallback('change');
		vi.advanceTimersByTime(100);
		watchCallback('change');
		vi.advanceTimersByTime(100);
		watchCallback('change');
		vi.advanceTimersByTime(500);
		expect(mockEmit).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it('closes previous watcher on project switch', async () => {
		const mockEmit = vi.fn();
		const {coreService: mockedCoreService} = await import('./coreService.js');
		const secondWatcher = {
			close: vi.fn(),
			on: vi.fn(() => secondWatcher),
		};
		mockWatch.mockReturnValueOnce(secondWatcher as unknown as FSWatcher);

		const internal = apiServer as unknown as {
			io: {emit: ReturnType<typeof vi.fn>} | undefined;
			setupTdDbWatcher: () => void;
		};
		internal['io'] = {emit: mockEmit};

		const onCalls = (mockedCoreService.on as ReturnType<typeof vi.fn>).mock
			.calls;
		const projectSelectedHandler = onCalls.find(
			([event]) => event === 'projectSelected',
		)?.[1] as (() => void) | undefined;
		expect(projectSelectedHandler).toBeDefined();
		projectSelectedHandler?.();

		expect(mockWatcher.close).toHaveBeenCalledTimes(1);
	});

	it('teardownTdDbWatcher clears pending debounce timer and closes watcher', async () => {
		const mockEmit = vi.fn();
		const internal = apiServer as unknown as {
			io: {emit: ReturnType<typeof vi.fn>} | undefined;
			setupTdDbWatcher: () => void;
			teardownTdDbWatcher: () => void;
		};
		internal['io'] = {emit: mockEmit};
		internal.setupTdDbWatcher();

		const watchCallback = mockWatch.mock.calls[
			mockWatch.mock.calls.length - 1
		]?.[1] as (eventType: string) => void;
		vi.useFakeTimers();
		watchCallback('change');
		vi.advanceTimersByTime(200);

		internal.teardownTdDbWatcher();
		vi.advanceTimersByTime(500);

		expect(mockEmit).not.toHaveBeenCalled();
		expect(mockWatcher.close).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('stop() closes watcher and clears pending timer', async () => {
		const mockEmit = vi.fn();
		const mockIoDisconnect = vi.fn();
		const mockIoClose = vi.fn();
		const mockAppClose = vi.fn().mockResolvedValue(undefined);
		const internal = apiServer as unknown as {
			io:
				| {
						emit: ReturnType<typeof vi.fn>;
						disconnectSockets: ReturnType<typeof vi.fn>;
						close: ReturnType<typeof vi.fn>;
				  }
				| undefined;
			setupTdDbWatcher: () => void;
			stop: () => Promise<void>;
			app: {close: typeof mockAppClose};
		};
		internal['io'] = {
			emit: mockEmit,
			disconnectSockets: mockIoDisconnect,
			close: mockIoClose,
		};
		internal.app = {close: mockAppClose};

		internal.setupTdDbWatcher();
		const watchCallback = mockWatch.mock.calls[
			mockWatch.mock.calls.length - 1
		]?.[1] as (eventType: string) => void;

		vi.useFakeTimers();
		watchCallback('change');
		vi.advanceTimersByTime(200);

		await internal.stop();
		vi.advanceTimersByTime(500);

		expect(mockIoDisconnect).toHaveBeenCalledWith(true);
		expect(mockIoClose).toHaveBeenCalled();
		expect(mockAppClose).toHaveBeenCalled();
		expect(mockEmit).not.toHaveBeenCalled();
		expect(mockWatcher.close).toHaveBeenCalled();
		vi.useRealTimers();
	});
});
