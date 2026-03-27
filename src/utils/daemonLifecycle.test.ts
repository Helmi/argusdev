import {afterEach, describe, expect, it, vi} from 'vitest';
import {mkdtemp, readFile, rm, writeFile} from 'fs/promises';
import {join} from 'path';
import {tmpdir} from 'os';
import {
	cleanupDaemonPidFile,
	prepareDaemonPidFile,
	readDaemonPidFile,
} from './daemonLifecycle.js';

describe('daemonLifecycle', () => {
	let testDir: string | undefined;

	const createPidFilePath = async (): Promise<string> => {
		testDir = await mkdtemp(join(tmpdir(), 'argusdev-daemon-pid-'));
		return join(testDir, 'daemon.pid');
	};

	afterEach(async () => {
		if (testDir) {
			await rm(testDir, {recursive: true, force: true});
			testDir = undefined;
		}
	});

	it('writes daemon pid file for current process', async () => {
		const pidFilePath = await createPidFilePath();
		await prepareDaemonPidFile(pidFilePath, 4242);

		const fileContent = await readFile(pidFilePath, 'utf-8');
		expect(fileContent.trim()).toBe('4242');
	});

	it('fails when a live daemon PID is already present', async () => {
		const pidFilePath = await createPidFilePath();
		await writeFile(pidFilePath, '9001\n', 'utf-8');

		await expect(
			prepareDaemonPidFile(pidFilePath, 4242, pid => pid === 9001),
		).rejects.toThrow('already running');
	});

	it('replaces stale daemon PID file', async () => {
		const pidFilePath = await createPidFilePath();
		await writeFile(pidFilePath, '9001\n', 'utf-8');

		await prepareDaemonPidFile(pidFilePath, 4242, () => false);

		const storedPid = await readDaemonPidFile(pidFilePath);
		expect(storedPid).toBe(4242);
	});

	it('supports start-stop-restart daemon PID lifecycle', async () => {
		const pidFilePath = await createPidFilePath();

		await prepareDaemonPidFile(pidFilePath, 1111);
		expect(await readDaemonPidFile(pidFilePath)).toBe(1111);

		await cleanupDaemonPidFile(pidFilePath, 1111);
		expect(await readDaemonPidFile(pidFilePath)).toBeUndefined();

		await prepareDaemonPidFile(pidFilePath, 2222);
		expect(await readDaemonPidFile(pidFilePath)).toBe(2222);
	});

	it('cleans up PID file only when current daemon owns it', async () => {
		const pidFilePath = await createPidFilePath();
		await writeFile(pidFilePath, '4242\n', 'utf-8');

		await cleanupDaemonPidFile(pidFilePath, 4242);
		expect(await readDaemonPidFile(pidFilePath)).toBeUndefined();

		await writeFile(pidFilePath, '9001\n', 'utf-8');
		await cleanupDaemonPidFile(pidFilePath, 4242);
		expect(await readDaemonPidFile(pidFilePath)).toBe(9001);
	});

	it('treats malformed PID files as stale and rewrites them', async () => {
		const pidFilePath = await createPidFilePath();
		await writeFile(pidFilePath, 'not-a-pid\n', 'utf-8');

		const processChecker = vi.fn(() => false);
		await prepareDaemonPidFile(pidFilePath, 4242, processChecker);

		expect(processChecker).not.toHaveBeenCalled();
		expect(await readDaemonPidFile(pidFilePath)).toBe(4242);
	});
});
