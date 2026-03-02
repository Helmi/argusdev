import {spawnSync} from 'child_process';
import dgram from 'dgram';
import dns from 'dns';
import os from 'os';
import type {DaemonWebConfig} from '../../utils/daemonControl.js';
import {
	getCachedUpdateCheck,
	getCurrentVersionString,
} from '../../services/versionCheckService.js';

export function formatDaemonVersionHeader(mode: string): string[] {
	const lines: string[] = [`CA⚡CD v${getCurrentVersionString()} — ${mode}`];
	const updateInfo = getCachedUpdateCheck();
	if (updateInfo?.isUpdateAvailable && updateInfo.latestVersion) {
		lines.push(
			`✦ Update available: v${updateInfo.latestVersion} → cacd update`,
		);
	}
	return lines;
}

export function getProcessUptime(pid: number): string | undefined {
	const result = spawnSync('ps', ['-p', `${pid}`, '-o', 'etime='], {
		encoding: 'utf-8',
	});

	if (result.status !== 0) {
		return undefined;
	}

	const uptime = result.stdout.trim();
	return uptime.length > 0 ? uptime : undefined;
}

export function getExternalIP(): Promise<string | undefined> {
	return new Promise(resolve => {
		const socket = dgram.createSocket('udp4');
		socket.connect(80, '8.8.8.8', () => {
			const addr = socket.address();
			socket.close();
			resolve(typeof addr === 'string' ? undefined : addr.address);
		});
		socket.on('error', () => {
			socket.close();
			resolve(undefined);
		});
	});
}

export function getLocalHostname(
	externalIP: string | undefined,
): Promise<string | undefined> {
	if (!externalIP) {
		return Promise.resolve(undefined);
	}

	return new Promise(resolve => {
		const hostname = os.hostname();
		dns.lookup(hostname, {family: 4}, (err, addr) => {
			if (!err && addr === externalIP) {
				resolve(hostname);
			} else {
				resolve(undefined);
			}
		});
	});
}

export async function withNetworkLinks(
	baseConfig: DaemonWebConfig,
	token: string | undefined,
): Promise<DaemonWebConfig> {
	const externalIP = await getExternalIP();
	const hostname = await getLocalHostname(externalIP);
	const tokenPath = token ? `/${token}` : '';

	return {
		...baseConfig,
		externalUrl: externalIP
			? `http://${externalIP}:${baseConfig.port}${tokenPath}`
			: undefined,
		hostname: hostname
			? `http://${hostname}:${baseConfig.port}${tokenPath}`
			: undefined,
	};
}
