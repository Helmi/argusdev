import Database from 'better-sqlite3';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
} from 'fs';
import {homedir} from 'os';
import path from 'path';
import {getConfigDir} from '../utils/configDir.js';
import {
	getClaudeProjectsDir,
	pathToClaudeProjectName,
} from '../utils/claudeDir.js';
import {Either} from 'effect';
import {logger} from '../utils/logger.js';
import {adapterRegistry} from '../adapters/index.js';

const DB_FILENAME = 'sessions.db';
const SCHEMA_VERSION = 2;
const DISCOVERY_RETRY_LIMIT = 8;
const DISCOVERY_RETRY_DELAY_MS = 1500;

type SqlPrimitive = string | number | null;

export type SessionIntent = 'work' | 'review' | 'manual';

export interface SessionRecord {
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
	intent: SessionIntent;
	createdAt: number;
	endedAt: number | null;
}

export interface CreateSessionRecordInput {
	id: string;
	agentProfileId: string;
	agentProfileName: string;
	agentType: string;
	agentOptions: Record<string, unknown>;
	worktreePath: string;
	branchName?: string;
	projectPath?: string;
	tdTaskId?: string;
	tdSessionId?: string;
	sessionName?: string;
	contentPreview?: string;
	intent?: SessionIntent;
	createdAt?: number;
}

export interface SessionQueryFilters {
	projectPath?: string;
	worktreePath?: string;
	tdTaskId?: string;
	dateFrom?: number;
	dateTo?: number;
	agentType?: string;
	limit?: number;
	offset?: number;
	search?: string;
}

interface SessionFileDiscoveryResult {
	path: string;
	agentSessionId: string | null;
}

interface SessionRow {
	id: string;
	agent_profile_id: string;
	agent_profile_name: string;
	agent_type: string;
	agent_options: string;
	agent_session_id: string | null;
	agent_session_path: string | null;
	worktree_path: string;
	branch_name: string | null;
	project_path: string | null;
	td_task_id: string | null;
	td_session_id: string | null;
	session_name: string | null;
	content_preview: string | null;
	intent: string;
	created_at: number;
	ended_at: number | null;
}

function normalizeOptionalString(value: string | undefined): string | null {
	if (!value) return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function toUnixSeconds(timestampMs = Date.now()): number {
	return Math.floor(timestampMs / 1000);
}

function parseAgentOptions(jsonValue: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(jsonValue);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function normalizeContentPreview(value: string | undefined): string | null {
	if (!value) return null;
	const normalized = value.replace(/\s+/g, ' ').trim();
	if (!normalized) return null;
	return normalized.length > 300
		? `${normalized.slice(0, 300)}...`
		: normalized;
}

function extractSessionIdFromFilename(filePath: string): string {
	return path.basename(filePath, path.extname(filePath));
}

function resolveDefaultDbPath(): string {
	try {
		return path.join(getConfigDir(), DB_FILENAME);
	} catch {
		return path.join(homedir(), '.config', 'cacd', DB_FILENAME);
	}
}

function isLikelyCorruptionError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const message = error.message.toLowerCase();
	return (
		message.includes('database disk image is malformed') ||
		message.includes('file is not a database') ||
		message.includes('malformed') ||
		message.includes('corrupt')
	);
}

export class SessionStore {
	private db: Database.Database;
	private readonly dbPath: string;
	private readonly discoveryTimers = new Map<string, NodeJS.Timeout>();

	constructor(dbPath?: string) {
		const resolvedDbPath = dbPath || resolveDefaultDbPath();
		this.dbPath = resolvedDbPath;
		this.db = this.openDatabaseWithRecovery();
	}

	private openDatabaseWithRecovery(): Database.Database {
		const directory = path.dirname(this.dbPath);
		if (!existsSync(directory)) {
			mkdirSync(directory, {recursive: true});
		}

		try {
			const db = new Database(this.dbPath);
			this.configureDatabase(db);
			this.runMigrations(db);
			return db;
		} catch (error) {
			if (!isLikelyCorruptionError(error)) {
				throw error;
			}

			logger.warn(
				`[SessionStore] Corrupt DB detected at ${this.dbPath}; recreating. Error: ${String(error)}`,
			);

			if (existsSync(this.dbPath)) {
				const backupPath = `${this.dbPath}.corrupt-${Date.now()}`;
				try {
					renameSync(this.dbPath, backupPath);
				} catch (renameError) {
					logger.warn(
						`[SessionStore] Failed to move corrupt DB (${String(renameError)}). Attempting fresh open anyway.`,
					);
				}
			}

			const db = new Database(this.dbPath);
			this.configureDatabase(db);
			this.runMigrations(db);
			return db;
		}
	}

	private reinitializeDatabase(): void {
		try {
			this.db.close();
		} catch {
			// ignore
		}
		this.db = this.openDatabaseWithRecovery();
	}

	private withRecovery<T>(operation: () => T): T {
		try {
			return operation();
		} catch (error) {
			if (!isLikelyCorruptionError(error)) {
				throw error;
			}

			logger.warn(
				`[SessionStore] Query failed due to DB corruption; reinitializing. Error: ${String(error)}`,
			);
			this.reinitializeDatabase();
			return operation();
		}
	}

	private configureDatabase(db: Database.Database): void {
		db.pragma('journal_mode = WAL');
		db.pragma('busy_timeout = 1000');
		db.pragma('foreign_keys = ON');
	}

	private runMigrations(db: Database.Database): void {
		const currentVersion = db.pragma('user_version', {simple: true}) as number;
		if (currentVersion >= SCHEMA_VERSION) {
			return;
		}

		if (currentVersion < 1) {
			db.exec(`
				CREATE TABLE IF NOT EXISTS sessions (
					id TEXT PRIMARY KEY,
					agent_profile_id TEXT NOT NULL,
					agent_profile_name TEXT NOT NULL,
					agent_type TEXT NOT NULL,
					agent_options TEXT NOT NULL,
					agent_session_id TEXT,
					agent_session_path TEXT,
					worktree_path TEXT NOT NULL,
					branch_name TEXT,
					project_path TEXT,
					td_task_id TEXT,
					td_session_id TEXT,
					session_name TEXT,
					content_preview TEXT,
					intent TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					ended_at INTEGER
				);

				CREATE INDEX IF NOT EXISTS idx_sessions_project_path ON sessions(project_path);
				CREATE INDEX IF NOT EXISTS idx_sessions_worktree_path ON sessions(worktree_path);
				CREATE INDEX IF NOT EXISTS idx_sessions_td_task_id ON sessions(td_task_id);
				CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
			`);
		}

		if (currentVersion < 2) {
			try {
				db.exec('ALTER TABLE sessions ADD COLUMN content_preview TEXT');
			} catch {
				// Column already exists in some migrated databases.
			}
		}

		db.pragma(`user_version = ${SCHEMA_VERSION}`);
	}

	createSessionRecord(input: CreateSessionRecordInput): void {
		const now = input.createdAt ?? toUnixSeconds();
		this.withRecovery(() => {
			const statement = this.db.prepare(`
				INSERT INTO sessions (
					id,
					agent_profile_id,
					agent_profile_name,
					agent_type,
					agent_options,
					agent_session_id,
					agent_session_path,
					worktree_path,
					branch_name,
					project_path,
					td_task_id,
					td_session_id,
					session_name,
					content_preview,
					intent,
					created_at,
					ended_at
				)
				VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
			`);

			statement.run(
				input.id,
				input.agentProfileId,
				input.agentProfileName,
				input.agentType,
				JSON.stringify(input.agentOptions || {}),
				input.worktreePath,
				normalizeOptionalString(input.branchName),
				normalizeOptionalString(input.projectPath),
				normalizeOptionalString(input.tdTaskId),
				normalizeOptionalString(input.tdSessionId),
				normalizeOptionalString(input.sessionName),
				normalizeContentPreview(input.contentPreview),
				input.intent || 'manual',
				now,
			);
		});
	}

	markSessionEnded(sessionId: string, endedAt = toUnixSeconds()): void {
		this.withRecovery(() => {
			this.db
				.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?')
				.run(endedAt, sessionId);
		});
	}

	markSessionResumed(sessionId: string): void {
		this.withRecovery(() => {
			this.db
				.prepare('UPDATE sessions SET ended_at = NULL WHERE id = ?')
				.run(sessionId);
		});
	}

	updateSessionName(sessionId: string, sessionName?: string): void {
		this.withRecovery(() => {
			this.db
				.prepare('UPDATE sessions SET session_name = ? WHERE id = ?')
				.run(normalizeOptionalString(sessionName), sessionId);
		});
	}

	updateSessionContentPreview(
		sessionId: string,
		contentPreview?: string,
	): void {
		this.withRecovery(() => {
			this.db
				.prepare('UPDATE sessions SET content_preview = ? WHERE id = ?')
				.run(normalizeContentPreview(contentPreview), sessionId);
		});
	}

	updateAgentSessionLink(
		sessionId: string,
		agentSessionPath: string,
		agentSessionId?: string,
	): void {
		this.withRecovery(() => {
			this.db
				.prepare(
					'UPDATE sessions SET agent_session_path = ?, agent_session_id = ? WHERE id = ?',
				)
				.run(
					agentSessionPath,
					normalizeOptionalString(agentSessionId) ||
						extractSessionIdFromFilename(agentSessionPath),
					sessionId,
				);
		});
	}

	getSessionById(sessionId: string): SessionRecord | null {
		return this.withRecovery(() => {
			const row = this.db
				.prepare('SELECT * FROM sessions WHERE id = ?')
				.get(sessionId) as SessionRow | undefined;
			return row ? this.mapRow(row) : null;
		});
	}

	querySessions(filters: SessionQueryFilters = {}): SessionRecord[] {
		return this.withRecovery(() => {
			const {whereClause, values} = this.buildWhereClause(filters);
			const limit = typeof filters.limit === 'number' ? filters.limit : 50;
			const offset = typeof filters.offset === 'number' ? filters.offset : 0;
			const query = `
				SELECT * FROM sessions
				${whereClause}
				ORDER BY created_at DESC
				LIMIT ? OFFSET ?
			`;

			const rows = this.db
				.prepare(query)
				.all(...values, limit, offset) as SessionRow[];
			return rows.map(row => this.mapRow(row));
		});
	}

	countSessions(filters: SessionQueryFilters = {}): number {
		return this.withRecovery(() => {
			const {whereClause, values} = this.buildWhereClause(filters);
			const row = this.db
				.prepare(`SELECT COUNT(*) as total FROM sessions ${whereClause}`)
				.get(...values) as {total: number};
			return row.total;
		});
	}

	queryByProject(projectPath: string, limit = 50, offset = 0): SessionRecord[] {
		return this.querySessions({projectPath, limit, offset});
	}

	queryByWorktree(
		worktreePath: string,
		limit = 50,
		offset = 0,
	): SessionRecord[] {
		return this.querySessions({worktreePath, limit, offset});
	}

	queryByTask(tdTaskId: string, limit = 50, offset = 0): SessionRecord[] {
		return this.querySessions({tdTaskId, limit, offset});
	}

	queryByDateRange(dateFrom: number, dateTo: number): SessionRecord[] {
		return this.querySessions({dateFrom, dateTo, limit: 5000, offset: 0});
	}

	getLatestByTdSessionId(params: {
		tdSessionId: string;
		tdTaskId?: string;
		projectPath?: string;
	}): SessionRecord | null {
		return this.withRecovery(() => {
			const clauses = ['td_session_id = ?'];
			const values: SqlPrimitive[] = [params.tdSessionId];

			if (params.tdTaskId) {
				clauses.push('td_task_id = ?');
				values.push(params.tdTaskId);
			}

			if (params.projectPath) {
				clauses.push('project_path = ?');
				values.push(params.projectPath);
			}

			const row = this.db
				.prepare(
					`SELECT * FROM sessions WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT 1`,
				)
				.get(...values) as SessionRow | undefined;
			return row ? this.mapRow(row) : null;
		});
	}

	getOriginalWorkTdSessionId(params: {
		tdTaskId: string;
		projectPath?: string;
	}): string | null {
		return this.withRecovery(() => {
			const clauses = [
				'td_task_id = ?',
				'intent = ?',
				'td_session_id IS NOT NULL',
			];
			const values: SqlPrimitive[] = [params.tdTaskId, 'work'];

			if (params.projectPath) {
				clauses.push('project_path = ?');
				values.push(params.projectPath);
			}

			const row = this.db
				.prepare(
					`SELECT td_session_id FROM sessions WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC LIMIT 1`,
				)
				.get(...values) as {td_session_id: string | null} | undefined;

			return row?.td_session_id || null;
		});
	}

	scheduleAgentSessionDiscovery(params: {
		sessionId: string;
		agentType: string;
		worktreePath: string;
		createdAt?: number;
	}): void {
		this.cancelAgentSessionDiscovery(params.sessionId);

		const attempt = async (remaining: number) => {
			const discovered = await this.findSessionFileForAgent(
				params.agentType,
				params.worktreePath,
				params.createdAt,
			);

			if (discovered) {
				this.updateAgentSessionLink(
					params.sessionId,
					discovered.path,
					discovered.agentSessionId || undefined,
				);
				await this.ensureSessionContentPreview(
					params.sessionId,
					params.agentType,
					discovered.path,
				);
				this.cancelAgentSessionDiscovery(params.sessionId);
				return;
			}

			if (remaining <= 0) {
				this.cancelAgentSessionDiscovery(params.sessionId);
				return;
			}

			const timeout = setTimeout(() => {
				void attempt(remaining - 1);
			}, DISCOVERY_RETRY_DELAY_MS);
			this.discoveryTimers.set(params.sessionId, timeout);
		};

		const timeout = setTimeout(() => {
			void attempt(DISCOVERY_RETRY_LIMIT);
		}, DISCOVERY_RETRY_DELAY_MS);
		this.discoveryTimers.set(params.sessionId, timeout);
	}

	cancelAgentSessionDiscovery(sessionId: string): void {
		const timer = this.discoveryTimers.get(sessionId);
		if (!timer) {
			return;
		}

		clearTimeout(timer);
		this.discoveryTimers.delete(sessionId);
	}

	async hydrateSessionContentPreview(sessionId: string): Promise<void> {
		const session = this.getSessionById(sessionId);
		if (!session) return;
		if (session.contentPreview) return;
		if (!session.agentSessionPath) return;
		if (!existsSync(session.agentSessionPath)) return;

		await this.ensureSessionContentPreview(
			session.id,
			session.agentType,
			session.agentSessionPath,
		);
	}

	close(): void {
		for (const sessionId of this.discoveryTimers.keys()) {
			this.cancelAgentSessionDiscovery(sessionId);
		}
		this.db.close();
	}

	private async findSessionFileForAgent(
		agentType: string,
		worktreePath: string,
		createdAtUnixSeconds?: number,
	): Promise<SessionFileDiscoveryResult | null> {
		const normalizedType = agentType.toLowerCase();
		const resolvedWorktreePath = path.resolve(worktreePath);
		const createdAtMs =
			typeof createdAtUnixSeconds === 'number'
				? createdAtUnixSeconds * 1000
				: undefined;
		const adapter = adapterRegistry.getByAgentType(normalizedType);
		if (adapter) {
			try {
				const sessionPath = await adapter.findSessionFile(
					resolvedWorktreePath,
					typeof createdAtMs === 'number' ? new Date(createdAtMs) : undefined,
				);
				if (!sessionPath) {
					return null;
				}
				const metadata = await adapter.extractMetadata(sessionPath);
				return {
					path: sessionPath,
					agentSessionId:
						metadata.agentSessionId ||
						extractSessionIdFromFilename(sessionPath),
				};
			} catch (error) {
				logger.warn(
					`[SessionStore] Adapter-based session discovery failed for ${agentType}: ${String(error)}`,
				);
			}
		}

		if (normalizedType === 'claude') {
			return this.findClaudeSessionFile(resolvedWorktreePath, createdAtMs);
		}

		if (normalizedType === 'codex') {
			return this.findCodexSessionFile(resolvedWorktreePath, createdAtMs);
		}

		return null;
	}

	private async ensureSessionContentPreview(
		sessionId: string,
		agentType: string,
		agentSessionPath: string,
	): Promise<void> {
		const adapter = adapterRegistry.getByAgentType(agentType);
		if (!adapter) {
			return;
		}

		try {
			const messages = await adapter.parseMessages(agentSessionPath);
			const firstMessage = messages.find(message => {
				const preview = normalizeContentPreview(
					message.preview || message.content || '',
				);
				return !!preview;
			});
			const preview = normalizeContentPreview(
				firstMessage?.preview || firstMessage?.content || undefined,
			);
			if (preview) {
				this.updateSessionContentPreview(sessionId, preview);
			}
		} catch (error) {
			logger.debug(
				`[SessionStore] Failed to derive content preview for ${sessionId}: ${String(error)}`,
			);
		}
	}

	private findClaudeSessionFile(
		worktreePath: string,
		createdAtMs?: number,
	): SessionFileDiscoveryResult | null {
		const projectsDirEither = getClaudeProjectsDir();
		if (Either.isLeft(projectsDirEither)) {
			return null;
		}

		const projectDirName = pathToClaudeProjectName(worktreePath);
		const projectDir = path.join(projectsDirEither.right, projectDirName);
		if (!existsSync(projectDir)) {
			return null;
		}

		const newest = this.findNewestMatchingFile(projectDir, filePath =>
			filePath.endsWith('.jsonl'),
		);
		if (!newest) {
			return null;
		}

		if (
			typeof createdAtMs === 'number' &&
			newest.mtimeMs + 120000 < createdAtMs
		) {
			return null;
		}

		return {
			path: newest.path,
			agentSessionId: extractSessionIdFromFilename(newest.path),
		};
	}

	private findCodexSessionFile(
		worktreePath: string,
		createdAtMs?: number,
	): SessionFileDiscoveryResult | null {
		const codexSessionsRoot = path.join(homedir(), '.codex', 'sessions');
		if (!existsSync(codexSessionsRoot)) {
			return null;
		}

		const candidates = this.collectCodexSessionCandidates(codexSessionsRoot)
			.filter(candidate =>
				typeof createdAtMs === 'number'
					? candidate.mtimeMs + 300000 >= createdAtMs
					: true,
			)
			.slice(0, 80);

		if (candidates.length === 0) {
			return null;
		}

		for (const candidate of candidates) {
			const parsed = this.matchCodexSessionFile(candidate.path, worktreePath);
			if (!parsed.matches) {
				continue;
			}

			return {
				path: candidate.path,
				agentSessionId:
					parsed.agentSessionId || extractSessionIdFromFilename(candidate.path),
			};
		}

		// Fallback: first recent candidate if we cannot reliably extract cwd.
		const fallback = candidates[0];
		if (!fallback) {
			return null;
		}

		return {
			path: fallback.path,
			agentSessionId: extractSessionIdFromFilename(fallback.path),
		};
	}

	private collectCodexSessionCandidates(
		rootPath: string,
	): Array<{path: string; mtimeMs: number}> {
		const candidates: Array<{path: string; mtimeMs: number}> = [];
		let years: string[];
		try {
			years = readdirSync(rootPath);
		} catch {
			return candidates;
		}

		for (const year of years) {
			const yearPath = path.join(rootPath, year);
			if (!this.isDirectory(yearPath)) continue;
			for (const month of this.safeReadDir(yearPath)) {
				const monthPath = path.join(yearPath, month);
				if (!this.isDirectory(monthPath)) continue;
				for (const day of this.safeReadDir(monthPath)) {
					const dayPath = path.join(monthPath, day);
					if (!this.isDirectory(dayPath)) continue;
					for (const fileName of this.safeReadDir(dayPath)) {
						if (
							!fileName.startsWith('rollout-') ||
							!fileName.endsWith('.jsonl')
						) {
							continue;
						}

						const filePath = path.join(dayPath, fileName);
						try {
							const stats = statSync(filePath);
							if (!stats.isFile()) {
								continue;
							}
							candidates.push({path: filePath, mtimeMs: stats.mtimeMs});
						} catch {
							// ignore unstable files
						}
					}
				}
			}
		}

		return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	}

	private matchCodexSessionFile(
		filePath: string,
		worktreePath: string,
	): {matches: boolean; agentSessionId: string | null} {
		let contents: string;
		try {
			contents = readFileSync(filePath, 'utf8');
		} catch {
			return {matches: false, agentSessionId: null};
		}

		const normalizedWorktree = path.resolve(worktreePath);
		const lines = contents.split('\n').slice(0, 120);
		let discoveredSessionId: string | null = null;

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as Record<string, unknown>;
				discoveredSessionId =
					discoveredSessionId ||
					this.extractStringField(parsed, ['session_id', 'sessionId']);

				const directCwd = this.extractStringField(parsed, [
					'cwd',
					'workdir',
					'working_dir',
					'current_working_directory',
				]);

				if (directCwd && path.resolve(directCwd) === normalizedWorktree) {
					return {matches: true, agentSessionId: discoveredSessionId};
				}

				const sessionMeta = parsed['session_meta'];
				if (sessionMeta && typeof sessionMeta === 'object') {
					const cwdFromMeta = this.extractStringField(
						sessionMeta as Record<string, unknown>,
						['cwd', 'workdir', 'working_dir'],
					);
					if (cwdFromMeta && path.resolve(cwdFromMeta) === normalizedWorktree) {
						return {matches: true, agentSessionId: discoveredSessionId};
					}
				}
			} catch {
				// ignore invalid JSON lines
			}
		}

		if (contents.includes(normalizedWorktree)) {
			return {matches: true, agentSessionId: discoveredSessionId};
		}

		return {matches: false, agentSessionId: null};
	}

	private extractStringField(
		record: Record<string, unknown>,
		keys: string[],
	): string | null {
		for (const key of keys) {
			const value = record[key];
			if (typeof value === 'string' && value.trim().length > 0) {
				return value;
			}
		}

		return null;
	}

	private buildWhereClause(filters: SessionQueryFilters): {
		whereClause: string;
		values: SqlPrimitive[];
	} {
		const clauses: string[] = [];
		const values: SqlPrimitive[] = [];

		if (filters.projectPath) {
			clauses.push('project_path = ?');
			values.push(filters.projectPath);
		}
		if (filters.worktreePath) {
			clauses.push('worktree_path = ?');
			values.push(filters.worktreePath);
		}
		if (filters.tdTaskId) {
			clauses.push('td_task_id = ?');
			values.push(filters.tdTaskId);
		}
		if (typeof filters.dateFrom === 'number') {
			clauses.push('created_at >= ?');
			values.push(filters.dateFrom);
		}
		if (typeof filters.dateTo === 'number') {
			clauses.push('created_at <= ?');
			values.push(filters.dateTo);
		}
		if (filters.agentType) {
			clauses.push('agent_type = ?');
			values.push(filters.agentType);
		}
		if (filters.search) {
			clauses.push(
				'(session_name LIKE ? OR content_preview LIKE ? OR branch_name LIKE ? OR td_task_id LIKE ? OR agent_profile_name LIKE ?)',
			);
			const search = `%${filters.search}%`;
			values.push(search, search, search, search, search);
		}

		if (clauses.length === 0) {
			return {whereClause: '', values};
		}

		return {
			whereClause: `WHERE ${clauses.join(' AND ')}`,
			values,
		};
	}

	private mapRow(row: SessionRow): SessionRecord {
		const intent =
			row.intent === 'work' || row.intent === 'review' ? row.intent : 'manual';

		return {
			id: row.id,
			agentProfileId: row.agent_profile_id,
			agentProfileName: row.agent_profile_name,
			agentType: row.agent_type,
			agentOptions: parseAgentOptions(row.agent_options),
			agentSessionId: row.agent_session_id,
			agentSessionPath: row.agent_session_path,
			worktreePath: row.worktree_path,
			branchName: row.branch_name,
			projectPath: row.project_path,
			tdTaskId: row.td_task_id,
			tdSessionId: row.td_session_id,
			sessionName: row.session_name,
			contentPreview: row.content_preview,
			intent,
			createdAt: row.created_at,
			endedAt: row.ended_at,
		};
	}

	private isDirectory(dirPath: string): boolean {
		try {
			return statSync(dirPath).isDirectory();
		} catch {
			return false;
		}
	}

	private safeReadDir(dirPath: string): string[] {
		try {
			return readdirSync(dirPath);
		} catch {
			return [];
		}
	}

	private findNewestMatchingFile(
		dirPath: string,
		matcher: (filePath: string) => boolean,
	): {path: string; mtimeMs: number} | null {
		const files = this.safeReadDir(dirPath);
		let bestMatch: {path: string; mtimeMs: number} | null = null;

		for (const fileName of files) {
			const filePath = path.join(dirPath, fileName);
			if (!matcher(filePath)) {
				continue;
			}

			try {
				const stats = statSync(filePath);
				if (!stats.isFile()) {
					continue;
				}

				if (!bestMatch || stats.mtimeMs > bestMatch.mtimeMs) {
					bestMatch = {path: filePath, mtimeMs: stats.mtimeMs};
				}
			} catch {
				// ignore unstable files
			}
		}

		return bestMatch;
	}
}

export const sessionStore = new SessionStore();
