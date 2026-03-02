import type {ConfigurationData, Project} from '../types/index.js';
import type {DaemonWebConfig} from '../utils/daemonControl.js';
import type {OutputFormatter} from './formatter.js';

export interface CliFlags {
	port?: number;
	headless: boolean;
	devcUpCommand?: string;
	devcExecCommand?: string;
	sessions: boolean;
	noWeb: boolean;
	project?: string;
	branch?: string;
	task?: string;
	target?: string;
	skipProject: boolean;
	force: boolean;
	json: boolean;
	agent?: string;
	model?: string;
	worktree?: string;
	name?: string;
	taskList?: string;
	promptTemplate?: string;
	intent?: string;
	option?: string | string[];
	description?: string;
}

export interface ParsedCliArgs {
	input: string[];
	flags: CliFlags;
}

export interface ProjectManagerAdapter {
	addProject(projectPath: string): Project | null;
	removeProject(projectPath: string): boolean;
	getProjects(): Project[];
	instance: {
		validateProjects(): void;
		updateProject(
			projectPath: string,
			updates: Partial<Pick<Project, 'name' | 'description'>>,
		): Project | null;
	};
}

export interface ConfigurationManagerAdapter {
	getConfiguration(): ConfigurationData;
	getPort(): number | undefined;
	setPort(port: number): void;
	updateAuthCredentials(credentials: {
		accessToken?: string;
		passcodeHash?: string;
	}): void;
}

export interface WorktreeConfigManagerAdapter {
	initialize(): void;
}

export interface GlobalSessionOrchestratorAdapter {
	destroyAllSessions(): void;
}

export interface ApiServerAdapter {
	start(
		port: number,
		host?: string,
		devMode?: boolean,
		allowRandomPortFallback?: boolean,
	): Promise<{port: number; address: string}>;
}

export interface DaemonLifecycleAdapter {
	prepareDaemonPidFile(pidFilePath: string, currentPid: number): Promise<void>;
	cleanupDaemonPidFile(pidFilePath: string, expectedPid: number): Promise<void>;
	readDaemonPidFile(pidFilePath: string): Promise<number | undefined>;
	isProcessRunning(pid: number): boolean;
}

export interface DaemonControlAdapter {
	buildDaemonWebConfig(params: {
		configDir: string;
		port: number;
		accessToken?: string;
		isCustomConfigDir: boolean;
		isDevMode: boolean;
	}): DaemonWebConfig;
	ensureDaemonForTui(params: {
		configDir: string;
		port: number;
		accessToken?: string;
		isCustomConfigDir: boolean;
		isDevMode: boolean;
		autoStart: boolean;
	}): Promise<{
		webConfig: DaemonWebConfig;
		pidFilePath: string;
		pid?: number;
		started: boolean;
	}>;
	spawnDetachedDaemon(
		entrypointPath: string,
		port: number,
		options?: {
			logFilePath?: string;
		},
	): {
		pid?: number;
		unref(): void;
	};
	waitForDaemonPid(params: {
		pidFilePath: string;
		deadline: number;
		pollIntervalMs: number;
	}): Promise<number>;
	waitForDaemonApiReady(params: {
		baseUrl: string;
		accessToken?: string;
		deadline: number;
		pollIntervalMs: number;
	}): Promise<void>;
}

export interface CliRuntimeServices {
	projectManager: ProjectManagerAdapter;
	configurationManager: ConfigurationManagerAdapter;
	worktreeConfigManager: WorktreeConfigManagerAdapter;
	globalSessionOrchestrator: GlobalSessionOrchestratorAdapter;
	apiServer: ApiServerAdapter;
}

export interface CliRuntimeDaemon {
	lifecycle: DaemonLifecycleAdapter;
	control: DaemonControlAdapter;
}

export interface CliCommandContext {
	subcommand: string;
	parsedArgs: ParsedCliArgs;
	formatter: OutputFormatter;
	port: number;
	isPortConfigured: boolean;
	configDir: string;
	customConfigDir: boolean;
	devModeActive: boolean;
	accessToken?: string;
	daemonPidFilePath: string;
	daemonLogPath: string;
	entrypointPath?: string;
	services: CliRuntimeServices;
	daemon: CliRuntimeDaemon;
}

export type CliCommandHandler = (context: CliCommandContext) => Promise<number>;
