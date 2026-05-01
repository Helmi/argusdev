import Database from 'better-sqlite3';
import {logger} from '../utils/logger.js';

/**
 * Normalize an issue ID to always include the `td-` prefix.
 *
 * The td CLI stores issue.id values prefixed (`td-c4c615`), but real-world
 * data shows that parent_id and issue_dependencies columns sometimes lack
 * the prefix (`c4c615`). The WebUI's buildGraph matches edge endpoints
 * against issue.id by exact equality — without normalization, every bare
 * reference silently drops its edge. Apply this at read time so the rest
 * of the pipeline can treat IDs uniformly.
 *
 * Empty strings are preserved as-is (means "no parent").
 */
function normalizeIssueId(id: string | null | undefined): string {
	if (!id) return '';
	return id.startsWith('td-') ? id : `td-${id}`;
}

// --- Types matching td's SQLite schema ---

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

export interface TdHandoff {
	id: string;
	issue_id: string;
	session_id: string;
	done: string; // JSON array
	remaining: string; // JSON array
	decisions: string; // JSON array
	uncertain: string; // JSON array
	timestamp: string;
}

export interface TdGitSnapshot {
	id: string;
	issue_id: string;
	event: string;
	commit_sha: string;
	branch: string;
	dirty_files: number;
	timestamp: string;
}

export interface TdIssueFile {
	id: string;
	issue_id: string;
	file_path: string;
	role: string;
	linked_sha: string;
	linked_at: string;
}

export interface TdIssueDependency {
	id: string;
	issue_id: string;
	depends_on_id: string;
	relation_type: string;
}

export interface TdComment {
	id: string;
	issue_id: string;
	session_id: string;
	text: string;
	created_at: string;
}

// --- Parsed types for UI consumption ---

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

export interface TdIssueWithChildren extends TdIssue {
	children: TdIssue[];
	handoffs: TdHandoffParsed[];
	files: TdIssueFile[];
	comments: TdComment[];
	rejectionReason: string | null;
}

/**
 * TdReader — Read-only access to td's SQLite database.
 *
 * Opens the database in WAL mode with readonly flag to avoid conflicts
 * with the td CLI writing to it. Each instance holds a connection to
 * one database file. Create new instances when switching projects.
 *
 * This class is intentionally read-only. All mutations go through the td CLI.
 */
export class TdReader {
	private db: Database.Database | null = null;
	private readonly dbPath: string;

	constructor(dbPath: string) {
		this.dbPath = dbPath;
	}

	/**
	 * Open the database connection. Lazy — called automatically on first query.
	 */
	private open(): Database.Database {
		if (this.db) return this.db;

		try {
			this.db = new Database(this.dbPath, {readonly: true});
			// Enable WAL mode for concurrent reads while td CLI writes
			this.db.pragma('journal_mode = WAL');
			// Don't wait for locks — fail fast if db is busy
			this.db.pragma('busy_timeout = 1000');
			logger.info(`[TdReader] Opened database: ${this.dbPath}`);
		} catch (error) {
			logger.error(`[TdReader] Failed to open database: ${this.dbPath}`, error);
			throw error;
		}

		return this.db;
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			logger.info(`[TdReader] Closed database: ${this.dbPath}`);
		}
	}

	/**
	 * Check if the database is accessible.
	 */
	isAccessible(): boolean {
		try {
			this.open();
			return true;
		} catch {
			return false;
		}
	}

	// --- Issue queries ---

	/**
	 * Get all non-deleted issues, optionally filtered by status.
	 */
	listIssues(options?: {
		status?: string;
		type?: string;
		parentId?: string;
		hideDeferred?: boolean;
	}): TdIssue[] {
		try {
			const db = this.open();
			let sql = 'SELECT * FROM issues WHERE deleted_at IS NULL';
			const params: string[] = [];

			if (options?.status) {
				const statuses = options.status
					.split(',')
					.map(s => s.trim())
					.filter(Boolean);
				if (statuses.length === 1) {
					sql += ' AND status = ?';
					params.push(statuses[0]!);
				} else if (statuses.length > 1) {
					sql += ` AND status IN (${statuses.map(() => '?').join(',')})`;
					params.push(...statuses);
				}
			}
			if (options?.type) {
				sql += ' AND type = ?';
				params.push(options.type);
			}
			if (options?.parentId) {
				// Match both prefixed and bare forms — DB content is inconsistent.
				const bare = options.parentId.startsWith('td-')
					? options.parentId.slice(3)
					: options.parentId;
				sql += ' AND (parent_id = ? OR parent_id = ?)';
				params.push(`td-${bare}`, bare);
			}
			if (options?.hideDeferred) {
				sql += " AND (defer_until IS NULL OR defer_until <= datetime('now'))";
			}

			sql +=
				" ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END ASC, updated_at DESC";

			const rows = db.prepare(sql).all(...params) as TdIssue[];
			return rows.map(row => ({
				...row,
				parent_id: normalizeIssueId(row.parent_id),
			}));
		} catch (error) {
			logger.error('[TdReader] Failed to list issues', error);
			return [];
		}
	}

	/**
	 * Get a single issue by ID.
	 */
	getIssue(issueId: string): TdIssue | null {
		try {
			const db = this.open();
			const row = db
				.prepare('SELECT * FROM issues WHERE id = ? AND deleted_at IS NULL')
				.get(issueId) as TdIssue | undefined;
			if (!row) return null;
			// Normalize parent_id so TaskDetailModal renders the same form
			// as graph/list views (both already pass through normalization).
			return {...row, parent_id: normalizeIssueId(row.parent_id)};
		} catch (error) {
			logger.error(`[TdReader] Failed to get issue ${issueId}`, error);
			return null;
		}
	}

	/**
	 * Get an issue with its children, handoffs, files, and rejection reason.
	 */
	getIssueWithDetails(issueId: string): TdIssueWithChildren | null {
		const issue = this.getIssue(issueId);
		if (!issue) return null;

		return {
			...issue,
			children: this.listIssues({parentId: issueId}),
			handoffs: this.getHandoffs(issueId),
			files: this.getIssueFiles(issueId),
			comments: this.getComments(issueId),
			rejectionReason: this.getLatestRejectionReason(issueId),
		};
	}

	/**
	 * Get all epics (type=epic, non-deleted).
	 */
	listEpics(): TdIssue[] {
		return this.listIssues({type: 'epic'});
	}

	/**
	 * Get children of an issue (tasks/stories under an epic).
	 */
	listChildren(parentId: string): TdIssue[] {
		return this.listIssues({parentId});
	}

	/**
	 * Get issues by status for board view (grouped by status).
	 */
	getBoard(): Record<string, TdIssue[]> {
		const issues = this.listIssues({hideDeferred: true});
		const board: Record<string, TdIssue[]> = {};

		// Children of open epics used to be hidden from the board, on the
		// assumption that the epic implicitly represented them. In practice
		// this made the parent→child relationship invisible at the board
		// level — clicking an epic revealed nothing. Surface every issue in
		// its own status column; the epic still carries a child-count badge
		// in the WebUI for visual hierarchy.
		for (const issue of issues) {
			const status = issue.status;
			if (!board[status]) {
				board[status] = [];
			}
			board[status]!.push(issue);
		}

		return board;
	}

	// --- Handoff queries ---

	/**
	 * Get handoffs for an issue, parsed from JSON.
	 */
	getHandoffs(issueId: string): TdHandoffParsed[] {
		try {
			const db = this.open();
			const rows = db
				.prepare(
					'SELECT * FROM handoffs WHERE issue_id = ? ORDER BY timestamp DESC',
				)
				.all(issueId) as TdHandoff[];

			return rows.map(row => ({
				id: row.id,
				issueId: row.issue_id,
				sessionId: row.session_id,
				done: safeJsonParse(row.done),
				remaining: safeJsonParse(row.remaining),
				decisions: safeJsonParse(row.decisions),
				uncertain: safeJsonParse(row.uncertain),
				timestamp: row.timestamp,
			}));
		} catch (error) {
			logger.error(`[TdReader] Failed to get handoffs for ${issueId}`, error);
			return [];
		}
	}

	/**
	 * Get the latest handoff for an issue.
	 */
	getLatestHandoff(issueId: string): TdHandoffParsed | null {
		const handoffs = this.getHandoffs(issueId);
		return handoffs[0] ?? null;
	}

	// --- File queries ---

	/**
	 * Get files linked to an issue.
	 */
	getIssueFiles(issueId: string): TdIssueFile[] {
		try {
			const db = this.open();
			return db
				.prepare('SELECT * FROM issue_files WHERE issue_id = ?')
				.all(issueId) as TdIssueFile[];
		} catch (error) {
			logger.error(`[TdReader] Failed to get files for ${issueId}`, error);
			return [];
		}
	}

	/**
	 * Get comments for an issue.
	 */
	getComments(issueId: string): TdComment[] {
		try {
			const db = this.open();
			return db
				.prepare(
					'SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC',
				)
				.all(issueId) as TdComment[];
		} catch (error) {
			logger.error(`[TdReader] Failed to get comments for ${issueId}`, error);
			return [];
		}
	}

	// --- Git snapshot queries ---

	/**
	 * Get git snapshots for an issue.
	 */
	getGitSnapshots(issueId: string): TdGitSnapshot[] {
		try {
			const db = this.open();
			return db
				.prepare(
					'SELECT * FROM git_snapshots WHERE issue_id = ? ORDER BY timestamp DESC',
				)
				.all(issueId) as TdGitSnapshot[];
		} catch (error) {
			logger.error(
				`[TdReader] Failed to get git snapshots for ${issueId}`,
				error,
			);
			return [];
		}
	}

	// --- Dependency queries ---

	/**
	 * Get dependencies for an issue.
	 */
	getDependencies(issueId: string): TdIssueDependency[] {
		try {
			const db = this.open();
			// Match against both prefixed and bare DB values, since
			// issue_dependencies rows in real-world data are inconsistent.
			const bare = issueId.startsWith('td-') ? issueId.slice(3) : issueId;
			const rows = db
				.prepare(
					'SELECT * FROM issue_dependencies WHERE issue_id = ? OR issue_id = ?',
				)
				.all(`td-${bare}`, bare) as TdIssueDependency[];
			return rows.map(row => ({
				...row,
				issue_id: normalizeIssueId(row.issue_id),
				depends_on_id: normalizeIssueId(row.depends_on_id),
			}));
		} catch (error) {
			logger.error(
				`[TdReader] Failed to get dependencies for ${issueId}`,
				error,
			);
			return [];
		}
	}

	/**
	 * Get every dependency edge in the project. Returns the full set —
	 * no paging, no filtering. Intended for the graph view which needs
	 * the entire edge map in one query.
	 */
	getAllDependencies(): TdIssueDependency[] {
		try {
			const db = this.open();
			const rows = db
				.prepare('SELECT * FROM issue_dependencies')
				.all() as TdIssueDependency[];
			// Same prefix-normalization as listIssues — issue_dependencies
			// rows in real-world data store endpoints without `td-`.
			return rows.map(row => ({
				...row,
				issue_id: normalizeIssueId(row.issue_id),
				depends_on_id: normalizeIssueId(row.depends_on_id),
			}));
		} catch (error) {
			logger.error('[TdReader] Failed to get all dependencies', error);
			return [];
		}
	}

	// --- Rejection queries ---

	/**
	 * Get the most recent rejection reason for an issue.
	 * Returns null if the issue has never been rejected.
	 *
	 * Rejection reasons are stored in the logs table with messages
	 * starting with "Rejected:" (written by `td reject -c "reason"`).
	 */
	getLatestRejectionReason(issueId: string): string | null {
		try {
			const db = this.open();
			const row = db
				.prepare(
					`SELECT message FROM logs
					 WHERE issue_id = ?
					   AND message LIKE 'Rejected:%'
					 ORDER BY timestamp DESC
					 LIMIT 1`,
				)
				.get(issueId) as {message: string} | undefined;

			if (!row) return null;

			// Strip the "Rejected: " prefix
			const prefix = 'Rejected: ';
			return row.message.startsWith(prefix)
				? row.message.slice(prefix.length)
				: row.message;
		} catch (error) {
			logger.error(
				`[TdReader] Failed to get rejection reason for ${issueId}`,
				error,
			);
			return null;
		}
	}

	/**
	 * Batch-query which issue IDs from a given set have ever been rejected.
	 * Returns a Set of issue IDs that have at least one "Rejected:" log entry.
	 */
	getRejectedIssueIds(issueIds: string[]): Set<string> {
		if (issueIds.length === 0) return new Set();
		try {
			const db = this.open();
			const placeholders = issueIds.map(() => '?').join(',');
			const rows = db
				.prepare(
					`SELECT DISTINCT issue_id FROM logs
					 WHERE issue_id IN (${placeholders})
					   AND message LIKE 'Rejected:%'`,
				)
				.all(...issueIds) as {issue_id: string}[];
			return new Set(rows.map(r => r.issue_id));
		} catch (error) {
			logger.error(
				'[TdReader] Failed to batch-query rejected issue IDs',
				error,
			);
			return new Set();
		}
	}

	// --- Search ---

	/**
	 * Search issues by title or description.
	 */
	searchIssues(query: string): TdIssue[] {
		try {
			const db = this.open();
			const pattern = `%${query}%`;
			return db
				.prepare(
					`SELECT * FROM issues
					 WHERE deleted_at IS NULL
					   AND (title LIKE ? OR description LIKE ? OR id LIKE ?)
					 ORDER BY updated_at DESC`,
				)
				.all(pattern, pattern, pattern) as TdIssue[];
		} catch (error) {
			logger.error(`[TdReader] Failed to search issues`, error);
			return [];
		}
	}
}

function safeJsonParse(value: string): string[] {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
