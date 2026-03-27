import {Effect, Either} from 'effect';
import {EventEmitter} from 'events';
import {SessionManager} from './sessionManager.js';
import {WorktreeService} from './worktreeService.js';
import {globalSessionOrchestrator} from './globalSessionOrchestrator.js';
import {projectManager} from './projectManager.js';
// import {configurationManager} from './configurationManager.js'; // TODO: integrate config
import {GitProject, Worktree, Session} from '../types/index.js';
import {AppError} from '../types/errors.js';

// Define the global application state
export interface AppState {
	selectedProject: GitProject | null;
	activeSession: Session | null;
	worktrees: Worktree[];
	// We might add more UI-agnostic state here
}

export class CoreService extends EventEmitter {
	private static instance: CoreService;

	// Dev mode detection for hot reload cleanup
	private static readonly isDevMode = process.env['ARGUSDEV_DEV'] === '1';

	// Services
	public sessionManager: SessionManager;
	public worktreeService: WorktreeService;

	// State
	private state: AppState = {
		selectedProject: null,
		activeSession: null,
		worktrees: [],
	};

	private constructor() {
		super();

		// Hot reload cleanup: Destroy previous instance if exists in dev mode
		if (CoreService.isDevMode && CoreService.instance) {
			CoreService.destroy();
		}

		// Initialize with default services
		this.sessionManager = globalSessionOrchestrator.getManagerForProject();
		this.worktreeService = new WorktreeService();

		// Setup initial listeners
		this.setupServiceListeners();
	}

	public static getInstance(): CoreService {
		if (!CoreService.instance) {
			CoreService.instance = new CoreService();
		}
		return CoreService.instance;
	}

	/**
	 * Destroy the CoreService instance and cleanup all resources.
	 * Called on hot reload in dev mode to prevent resource accumulation.
	 */
	public static destroy(): void {
		if (CoreService.instance) {
			// Remove all event listeners
			CoreService.instance.removeAllListeners();

			// Cleanup session manager intervals and listeners
			if (typeof CoreService.instance.sessionManager.destroy === 'function') {
				CoreService.instance.sessionManager.destroy();
			}

			// Reset instance
			CoreService.instance = null as unknown as CoreService;

			if (CoreService.isDevMode) {
				console.log(
					'[CoreService] Destroyed CoreService instance for hot reload',
				);
			}
		}
	}

	private setupServiceListeners() {
		// Forward session events
		this.sessionManager.on('sessionCreated', session =>
			this.emit('sessionCreated', session),
		);
		this.sessionManager.on('sessionExit', session =>
			this.handleSessionExit(session),
		);
		this.sessionManager.on('sessionStateChanged', session =>
			this.emit('sessionStateChanged', session),
		);
		this.sessionManager.on('sessionUpdated', session =>
			this.emit('sessionUpdated', session),
		);
		this.sessionManager.on('sessionData', (session, data) =>
			this.emit('sessionData', session, data),
		);
		this.sessionManager.on('sessionDestroyed', session =>
			this.emit('sessionDestroyed', session),
		);
	}

	private handleSessionExit(session: Session) {
		if (this.state.activeSession?.id === session.id) {
			this.state.activeSession = null;
			this.emit('activeSessionChanged', null);
		}
		this.emit('sessionExit', session);
	}

	// --- State Accessors ---

	public getState(): AppState {
		return {...this.state};
	}

	public getActiveSession(): Session | null {
		return this.state.activeSession;
	}

	public getSelectedProject(): GitProject | null {
		return this.state.selectedProject;
	}

	// --- Actions ---

	public async selectProject(project: GitProject): Promise<void> {
		this.state.selectedProject = project;

		// Update services for the new project
		this.worktreeService = new WorktreeService(project.path);
		this.sessionManager = globalSessionOrchestrator.getManagerForProject(
			project.path,
		);

		// Re-bind listeners to the new session manager
		this.sessionManager.removeAllListeners(); // Be careful not to remove internal listeners if any
		this.setupServiceListeners();

		// Update lastAccessed in project registry
		projectManager.instance.selectProject(project);

		this.emit('projectSelected', project);
		this.emit('servicesUpdated', {
			sessionManager: this.sessionManager,
			worktreeService: this.worktreeService,
		});
	}

	public resetProject(): void {
		this.state.selectedProject = null;
		this.worktreeService = new WorktreeService();
		this.sessionManager = globalSessionOrchestrator.getManagerForProject();

		// Re-bind listeners
		this.sessionManager.removeAllListeners();
		this.setupServiceListeners();

		this.emit('projectSelected', null);
		this.emit('servicesUpdated', {
			sessionManager: this.sessionManager,
			worktreeService: this.worktreeService,
		});
	}

	public setActiveSession(session: Session | null): void {
		this.state.activeSession = session;
		if (session) {
			this.sessionManager.setSessionActive(session.id, true);
		}
		this.emit('activeSessionChanged', session);
	}

	public async refreshWorktrees(): Promise<
		Either.Either<Worktree[], AppError>
	> {
		const result = await Effect.runPromise(
			Effect.either(this.worktreeService.getWorktreesEffect()),
		);
		if (result._tag === 'Right') {
			this.state.worktrees = result.right;
			this.emit('worktreesUpdated', result.right);
		}
		return result;
	}

	// --- Project Registry Events ---

	/**
	 * Emit when a project is added to the registry.
	 * Called by apiServer after successful project add.
	 */
	public emitProjectAdded(projectPath: string): void {
		this.emit('projectAdded', projectPath);
	}

	/**
	 * Emit when a project is removed from the registry.
	 * Called by apiServer after successful project remove.
	 */
	public emitProjectRemoved(projectPath: string): void {
		this.emit('projectRemoved', projectPath);
	}
}

export const coreService = CoreService.getInstance();
