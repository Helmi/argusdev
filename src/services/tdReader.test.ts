import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import Database from 'better-sqlite3';
import {TdReader} from './tdReader.js';
import path from 'path';
import {unlinkSync} from 'fs';
import {tmpdir} from 'os';

vi.mock('../utils/logger.js', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

const TEST_DB_PATH = path.join(
	tmpdir(),
	`argusdev-tdreader-test-${process.pid}.db`,
);

function createTestDb(): void {
	// Clean up any previous test db
	try {
		unlinkSync(TEST_DB_PATH);
	} catch {
		// ignore
	}

	const db = new Database(TEST_DB_PATH);
	db.pragma('journal_mode = WAL');

	db.exec(`
		CREATE TABLE issues (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			description TEXT DEFAULT '',
			status TEXT NOT NULL DEFAULT 'open',
			type TEXT NOT NULL DEFAULT 'task',
			priority TEXT NOT NULL DEFAULT 'P2',
			points INTEGER DEFAULT 0,
			labels TEXT DEFAULT '',
			parent_id TEXT DEFAULT '',
			acceptance TEXT DEFAULT '',
			implementer_session TEXT DEFAULT '',
			reviewer_session TEXT DEFAULT '',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			closed_at DATETIME,
			deleted_at DATETIME,
			minor INTEGER DEFAULT 0,
			created_branch TEXT DEFAULT '',
			creator_session TEXT DEFAULT '',
			sprint TEXT DEFAULT '',
			defer_until TEXT,
			due_date TEXT,
			defer_count INTEGER DEFAULT 0
		);

		CREATE TABLE handoffs (
			id TEXT PRIMARY KEY,
			issue_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			done TEXT DEFAULT '[]',
			remaining TEXT DEFAULT '[]',
			decisions TEXT DEFAULT '[]',
			uncertain TEXT DEFAULT '[]',
			timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE git_snapshots (
			id TEXT PRIMARY KEY,
			issue_id TEXT NOT NULL,
			event TEXT NOT NULL,
			commit_sha TEXT NOT NULL,
			branch TEXT NOT NULL,
			dirty_files INTEGER DEFAULT 0,
			timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE issue_files (
			id TEXT PRIMARY KEY,
			issue_id TEXT NOT NULL,
			file_path TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'implementation',
			linked_sha TEXT DEFAULT '',
			linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(issue_id, file_path)
		);

		CREATE TABLE issue_dependencies (
			id TEXT PRIMARY KEY,
			issue_id TEXT NOT NULL,
			depends_on_id TEXT NOT NULL,
			relation_type TEXT NOT NULL DEFAULT 'depends_on',
			UNIQUE(issue_id, depends_on_id, relation_type)
		);

		CREATE TABLE comments (
			id TEXT PRIMARY KEY,
			issue_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			text TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE logs (
			id TEXT PRIMARY KEY,
			issue_id TEXT DEFAULT '',
			session_id TEXT NOT NULL,
			work_session_id TEXT DEFAULT '',
			message TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'progress',
			timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`);

	// Seed test data
	db.prepare(
		`INSERT INTO issues (id, title, status, type, priority, parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
	).run('td-001', 'Epic: Auth system', 'in_progress', 'epic', 'P1', '');

	db.prepare(
		`INSERT INTO issues (id, title, status, type, priority, parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
	).run('td-002', 'Add login page', 'open', 'task', 'P1', 'td-001');

	db.prepare(
		`INSERT INTO issues (id, title, status, type, priority, parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
	).run('td-003', 'Add logout', 'done', 'task', 'P2', 'td-001');

	db.prepare(
		`INSERT INTO issues (id, title, status, type, priority, parent_id, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
	).run('td-004', 'Deleted task', 'open', 'task', 'P3', '', '2024-01-01');

	db.prepare(
		`INSERT INTO handoffs (id, issue_id, session_id, done, remaining, decisions, uncertain) VALUES (?, ?, ?, ?, ?, ?, ?)`,
	).run(
		'h-001',
		'td-002',
		'ses_abc',
		'["Created form component"]',
		'["Add validation", "Connect to API"]',
		'["Using React Hook Form"]',
		'["Error message format"]',
	);

	db.prepare(
		`INSERT INTO issue_files (id, issue_id, file_path, role) VALUES (?, ?, ?, ?)`,
	).run('f-001', 'td-002', 'src/login.tsx', 'implementation');

	db.prepare(
		`INSERT INTO comments (id, issue_id, session_id, text, created_at) VALUES (?, ?, ?, ?, ?)`,
	).run(
		'c-001',
		'td-002',
		'ses_reviewer',
		'Please add validation error states before approval.',
		'2026-02-20 08:45:10 +0000 UTC',
	);

	// Add a rejected task for testing rejection detection
	db.prepare(
		`INSERT INTO issues (id, title, status, type, priority, parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
	).run('td-005', 'Rejected feature', 'in_progress', 'task', 'P1', '');

	// Add rejection logs for td-005
	db.prepare(
		`INSERT INTO logs (id, issue_id, session_id, message, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		'lg-001',
		'td-005',
		'ses_reviewer',
		'Rejected: Missing test coverage for edge cases.',
		'progress',
		'2026-02-20 10:00:00',
	);

	db.prepare(
		`INSERT INTO logs (id, issue_id, session_id, message, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		'lg-002',
		'td-005',
		'ses_reviewer2',
		'Rejected: Still missing error handling.',
		'progress',
		'2026-02-20 12:00:00',
	);

	// Add a regular progress log (not a rejection)
	db.prepare(
		`INSERT INTO logs (id, issue_id, session_id, message, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		'lg-003',
		'td-005',
		'ses_dev',
		'Fixed the edge cases',
		'progress',
		'2026-02-20 11:00:00',
	);

	db.close();
}

describe('TdReader', () => {
	beforeEach(() => {
		createTestDb();
	});

	afterEach(() => {
		try {
			unlinkSync(TEST_DB_PATH);
		} catch {
			// ignore
		}
		try {
			unlinkSync(TEST_DB_PATH + '-shm');
		} catch {
			// ignore
		}
		try {
			unlinkSync(TEST_DB_PATH + '-wal');
		} catch {
			// ignore
		}
	});

	describe('listIssues', () => {
		it('should list all non-deleted issues', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const issues = reader.listIssues();
			reader.close();

			// td-001, td-002, td-003, td-005 (td-004 is deleted)
			expect(issues).toHaveLength(4);
			expect(issues.find(i => i.id === 'td-004')).toBeUndefined();
		});

		it('should filter by status', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const issues = reader.listIssues({status: 'open'});
			reader.close();

			expect(issues).toHaveLength(1);
			expect(issues[0]!.id).toBe('td-002');
		});

		it('should filter by type', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const epics = reader.listIssues({type: 'epic'});
			reader.close();

			expect(epics).toHaveLength(1);
			expect(epics[0]!.id).toBe('td-001');
		});

		it('should filter by parentId', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const children = reader.listIssues({parentId: 'td-001'});
			reader.close();

			expect(children).toHaveLength(2);
		});

		it('should sort by priority first, then updated_at', () => {
			const db = new Database(TEST_DB_PATH);
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			).run('td-p0', 'Critical bug', 'open', 'task', 'P0', '2024-01-01');
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			).run('td-p3', 'Nice to have', 'open', 'task', 'P3', '2024-12-31');
			db.close();

			const reader = new TdReader(TEST_DB_PATH);
			const issues = reader.listIssues();
			reader.close();

			const ids = issues.map(i => i.id);
			// P0 should come first despite older updated_at
			expect(ids.indexOf('td-p0')).toBeLessThan(ids.indexOf('td-p3'));
			// P1 issues (td-001, td-002) should come before P2 (td-003)
			expect(ids.indexOf('td-001')).toBeLessThan(ids.indexOf('td-003'));
		});

		it('normalizes bare parent_id values by prepending td-', () => {
			// Real-world data shows parent_id sometimes stored without the
			// `td-` prefix even though id values always have it. The reader
			// must normalize so downstream graph builders can match endpoints.
			const db = new Database(TEST_DB_PATH);
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority, parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
			).run('td-bare-child', 'Bare-id child', 'open', 'task', 'P2', '001');
			db.close();

			const reader = new TdReader(TEST_DB_PATH);
			const issues = reader.listIssues();
			reader.close();

			const child = issues.find(i => i.id === 'td-bare-child');
			expect(child?.parent_id).toBe('td-001');
		});

		it('matches parentId queries against both prefixed and bare DB values', () => {
			const db = new Database(TEST_DB_PATH);
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority, parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
			).run('td-bare-1', 'Bare-id sibling', 'open', 'task', 'P2', '001');
			db.close();

			const reader = new TdReader(TEST_DB_PATH);
			const children = reader.listIssues({parentId: 'td-001'});
			reader.close();

			const ids = children.map(i => i.id).sort();
			// td-002, td-003 use prefixed parent_id; td-bare-1 uses '001'.
			expect(ids).toEqual(['td-002', 'td-003', 'td-bare-1']);
		});

		it('should hide deferred issues when hideDeferred is true', () => {
			const db = new Database(TEST_DB_PATH);
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority, defer_until) VALUES (?, ?, ?, ?, ?, ?)`,
			).run('td-deferred', 'Deferred task', 'open', 'task', 'P2', '2099-01-01');
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority, defer_until) VALUES (?, ?, ?, ?, ?, ?)`,
			).run(
				'td-past-defer',
				'Past deferred',
				'open',
				'task',
				'P2',
				'2020-01-01',
			);
			db.close();

			const reader = new TdReader(TEST_DB_PATH);

			// Without hideDeferred, all should appear
			const all = reader.listIssues();
			expect(all.find(i => i.id === 'td-deferred')).toBeDefined();
			expect(all.find(i => i.id === 'td-past-defer')).toBeDefined();

			// With hideDeferred, future-deferred should be hidden
			const filtered = reader.listIssues({hideDeferred: true});
			expect(filtered.find(i => i.id === 'td-deferred')).toBeUndefined();
			expect(filtered.find(i => i.id === 'td-past-defer')).toBeDefined();

			reader.close();
		});
	});

	describe('getIssue', () => {
		it('should get issue by id', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const issue = reader.getIssue('td-002');
			reader.close();

			expect(issue).not.toBeNull();
			expect(issue!.title).toBe('Add login page');
		});

		it('should not return deleted issues', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const issue = reader.getIssue('td-004');
			reader.close();

			expect(issue).toBeNull();
		});

		it('should return null for non-existent issue', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const issue = reader.getIssue('td-999');
			reader.close();

			expect(issue).toBeNull();
		});
	});

	describe('getIssueWithDetails', () => {
		it('should return issue with children, handoffs, files, and comments', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const issue = reader.getIssueWithDetails('td-002');
			reader.close();

			expect(issue).not.toBeNull();
			expect(issue!.handoffs).toHaveLength(1);
			expect(issue!.handoffs[0]!.done).toEqual(['Created form component']);
			expect(issue!.handoffs[0]!.remaining).toEqual([
				'Add validation',
				'Connect to API',
			]);
			expect(issue!.files).toHaveLength(1);
			expect(issue!.files[0]!.file_path).toBe('src/login.tsx');
			expect(issue!.comments).toHaveLength(1);
			expect(issue!.comments[0]).toEqual({
				id: 'c-001',
				issue_id: 'td-002',
				session_id: 'ses_reviewer',
				text: 'Please add validation error states before approval.',
				created_at: '2026-02-20 08:45:10 +0000 UTC',
			});
		});

		it('should handle missing comments table by returning empty comments', () => {
			const db = new Database(TEST_DB_PATH);
			db.exec('DROP TABLE comments;');
			db.close();

			const reader = new TdReader(TEST_DB_PATH);
			const issue = reader.getIssueWithDetails('td-002');
			reader.close();

			expect(issue).not.toBeNull();
			expect(issue!.comments).toEqual([]);
			expect(issue!.files).toHaveLength(1);
			expect(issue!.handoffs).toHaveLength(1);
		});
	});

	describe('getBoard', () => {
		it('should group every non-deleted, non-deferred issue by status', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const board = reader.getBoard();
			reader.close();

			// All issues land in their own status column. Children of open
			// epics used to be skipped — that hid the parent→child relationship
			// at the board level, so we surface them now.
			expect(board['in_progress']?.map(i => i.id).sort()).toEqual([
				'td-001',
				'td-005',
			]);
			expect(board['open']?.map(i => i.id)).toEqual(['td-002']);
			expect(board['done']?.map(i => i.id)).toEqual(['td-003']);
		});

		it('should surface child tasks of open epics in their own status column', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const board = reader.getBoard();
			reader.close();

			// td-002 (child of open epic td-001) must appear in the open column
			// rather than being hidden underneath the epic.
			expect(board['open']?.map(i => i.id)).toContain('td-002');
		});

		it('should hide deferred issues', () => {
			const db = new Database(TEST_DB_PATH);
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority, defer_until) VALUES (?, ?, ?, ?, ?, ?)`,
			).run(
				'td-deferred-board',
				'Deferred board task',
				'open',
				'task',
				'P2',
				'2099-01-01',
			);
			db.close();

			const reader = new TdReader(TEST_DB_PATH);
			const board = reader.getBoard();
			reader.close();

			const openIds = (board['open'] || []).map(i => i.id);
			expect(openIds).not.toContain('td-deferred-board');
		});

		it('should show child tasks when epic parent is closed', () => {
			const db = new Database(TEST_DB_PATH);
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority, parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
			).run(
				'td-closed-parent',
				'Closed Parent Epic',
				'closed',
				'epic',
				'P1',
				'',
			);
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority, parent_id) VALUES (?, ?, ?, ?, ?, ?)`,
			).run(
				'td-closed-child',
				'Child of Closed Epic',
				'open',
				'task',
				'P2',
				'td-closed-parent',
			);
			db.close();

			const reader = new TdReader(TEST_DB_PATH);
			const board = reader.getBoard();
			reader.close();

			const openIds = (board['open'] || []).map(i => i.id);
			expect(openIds).toContain('td-closed-child');
		});

		it('should sort issues by priority within each status column', () => {
			const db = new Database(TEST_DB_PATH);
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority) VALUES (?, ?, ?, ?, ?)`,
			).run('td-open-p0', 'Urgent open', 'open', 'task', 'P0');
			db.prepare(
				`INSERT INTO issues (id, title, status, type, priority) VALUES (?, ?, ?, ?, ?)`,
			).run('td-open-p3', 'Low open', 'open', 'task', 'P3');
			db.close();

			const reader = new TdReader(TEST_DB_PATH);
			const board = reader.getBoard();
			reader.close();

			const openIds = (board['open'] || []).map(i => i.id);
			expect(openIds.indexOf('td-open-p0')).toBeLessThan(
				openIds.indexOf('td-open-p3'),
			);
		});
	});

	describe('searchIssues', () => {
		it('should search by title', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const results = reader.searchIssues('login');
			reader.close();

			expect(results).toHaveLength(1);
			expect(results[0]!.id).toBe('td-002');
		});

		it('should search by id', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const results = reader.searchIssues('td-001');
			reader.close();

			expect(results).toHaveLength(1);
			expect(results[0]!.title).toBe('Epic: Auth system');
		});
	});

	describe('getAllDependencies', () => {
		it('returns the full set of dependency edges, not paged or filtered', () => {
			const db = new Database(TEST_DB_PATH);
			db.prepare(
				`INSERT INTO issue_dependencies (id, issue_id, depends_on_id, relation_type) VALUES (?, ?, ?, ?)`,
			).run('dep-001', 'td-002', 'td-001', 'depends_on');
			db.prepare(
				`INSERT INTO issue_dependencies (id, issue_id, depends_on_id, relation_type) VALUES (?, ?, ?, ?)`,
			).run('dep-002', 'td-003', 'td-001', 'depends_on');
			db.prepare(
				`INSERT INTO issue_dependencies (id, issue_id, depends_on_id, relation_type) VALUES (?, ?, ?, ?)`,
			).run('dep-003', 'td-005', 'td-002', 'depends_on');
			db.close();

			const reader = new TdReader(TEST_DB_PATH);
			const deps = reader.getAllDependencies();
			reader.close();

			expect(deps).toHaveLength(3);
			expect(deps.map(d => d.id).sort()).toEqual([
				'dep-001',
				'dep-002',
				'dep-003',
			]);
			expect(deps.find(d => d.id === 'dep-001')).toMatchObject({
				issue_id: 'td-002',
				depends_on_id: 'td-001',
				relation_type: 'depends_on',
			});

			// Cleanup so other tests in this file don't see these rows.
			const cleanup = new Database(TEST_DB_PATH);
			cleanup
				.prepare(
					`DELETE FROM issue_dependencies WHERE id IN ('dep-001','dep-002','dep-003')`,
				)
				.run();
			cleanup.close();
		});

		it('returns empty array for a project with no dependencies', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const deps = reader.getAllDependencies();
			reader.close();
			expect(deps).toEqual([]);
		});

		it('normalizes bare issue_id and depends_on_id by prepending td-', () => {
			// Mirror the parent_id quirk — issue_dependencies rows in real
			// data store endpoints without the td- prefix, breaking edge
			// lookups against issue.id values that always have it.
			const db = new Database(TEST_DB_PATH);
			db.prepare(
				`INSERT INTO issue_dependencies (id, issue_id, depends_on_id, relation_type) VALUES (?, ?, ?, ?)`,
			).run('dep-bare-1', '002', '001', 'depends_on');
			db.prepare(
				`INSERT INTO issue_dependencies (id, issue_id, depends_on_id, relation_type) VALUES (?, ?, ?, ?)`,
			).run('dep-mixed', 'td-005', '003', 'depends_on');
			db.close();

			const reader = new TdReader(TEST_DB_PATH);
			const deps = reader.getAllDependencies();
			reader.close();

			const bare = deps.find(d => d.id === 'dep-bare-1');
			expect(bare).toMatchObject({
				issue_id: 'td-002',
				depends_on_id: 'td-001',
			});
			const mixed = deps.find(d => d.id === 'dep-mixed');
			expect(mixed).toMatchObject({
				issue_id: 'td-005',
				depends_on_id: 'td-003',
			});

			const cleanup = new Database(TEST_DB_PATH);
			cleanup
				.prepare(
					`DELETE FROM issue_dependencies WHERE id IN ('dep-bare-1','dep-mixed')`,
				)
				.run();
			cleanup.close();
		});
	});

	describe('isAccessible', () => {
		it('should return true for valid database', () => {
			const reader = new TdReader(TEST_DB_PATH);
			expect(reader.isAccessible()).toBe(true);
			reader.close();
		});

		it('should return false for non-existent database', () => {
			const reader = new TdReader('/nonexistent/path/db');
			expect(reader.isAccessible()).toBe(false);
		});
	});

	describe('getLatestRejectionReason', () => {
		it('should return the most recent rejection reason', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const reason = reader.getLatestRejectionReason('td-005');
			reader.close();

			// The most recent rejection is from lg-002
			expect(reason).toBe('Still missing error handling.');
		});

		it('should return null for issues without rejections', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const reason = reader.getLatestRejectionReason('td-002');
			reader.close();

			expect(reason).toBeNull();
		});

		it('should return null for non-existent issues', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const reason = reader.getLatestRejectionReason('td-999');
			reader.close();

			expect(reason).toBeNull();
		});
	});

	describe('getIssueWithDetails rejectionReason', () => {
		it('should include rejection reason for rejected tasks', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const issue = reader.getIssueWithDetails('td-005');
			reader.close();

			expect(issue).not.toBeNull();
			expect(issue!.rejectionReason).toBe('Still missing error handling.');
		});

		it('should have null rejectionReason for non-rejected tasks', () => {
			const reader = new TdReader(TEST_DB_PATH);
			const issue = reader.getIssueWithDetails('td-002');
			reader.close();

			expect(issue).not.toBeNull();
			expect(issue!.rejectionReason).toBeNull();
		});
	});
});
