import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

function readSource(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('TaskContextCard regressions', () => {
	it('declares the task action hook before any early return branches', () => {
		const source = readSource('client/src/components/TaskContextCard.tsx');
		expect(source.indexOf('const runTaskAction = useCallback(')).toBeGreaterThan(
			-1,
		);
		expect(
			source.indexOf('const runTaskAction = useCallback('),
		).toBeLessThan(
			source.indexOf("if (!tdStatus?.projectState?.enabled)"),
		);
	});

	it('renders the td task section before the generic session info block', () => {
		const source = readSource('client/src/components/ContextSidebar.tsx');
		expect(
			source.indexOf('<TaskContextCard worktreePath={session.path} />'),
		).toBeLessThan(source.indexOf('/* Session Info - Header area'));
	});
});
