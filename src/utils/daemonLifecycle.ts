import {mkdir, readFile, unlink, writeFile} from 'fs/promises';
import {dirname, join} from 'path';

export const DAEMON_PID_FILENAME = 'daemon.pid';

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}

export function getDaemonPidFilePath(configDir: string): string {
	return join(configDir, DAEMON_PID_FILENAME);
}

export async function readDaemonPidFile(
	pidFilePath: string,
): Promise<number | undefined> {
	try {
		const raw = await readFile(pidFilePath, 'utf-8');
		const parsed = Number.parseInt(raw.trim(), 10);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			return undefined;
		}
		return parsed;
	} catch (error) {
		if (isErrnoException(error) && error.code === 'ENOENT') {
			return undefined;
		}
		throw error;
	}
}

export function isProcessRunning(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (isErrnoException(error) && error.code === 'ESRCH') {
			return false;
		}
		throw error;
	}
}

export async function prepareDaemonPidFile(
	pidFilePath: string,
	currentPid: number,
	processRunningChecker: (pid: number) => boolean = isProcessRunning,
): Promise<void> {
	const existingPid = await readDaemonPidFile(pidFilePath);
	if (
		existingPid !== undefined &&
		existingPid !== currentPid &&
		processRunningChecker(existingPid)
	) {
		throw new Error(
			`Another argusdev daemon is already running with PID ${existingPid}.`,
		);
	}

	await mkdir(dirname(pidFilePath), {recursive: true});
	await writeFile(pidFilePath, `${currentPid}\n`, 'utf-8');
}

export async function cleanupDaemonPidFile(
	pidFilePath: string,
	expectedPid: number,
): Promise<void> {
	try {
		const existingPid = await readDaemonPidFile(pidFilePath);
		if (existingPid !== undefined && existingPid !== expectedPid) {
			return;
		}
		await unlink(pidFilePath);
	} catch (error) {
		if (isErrnoException(error) && error.code === 'ENOENT') {
			return;
		}
		throw error;
	}
}
