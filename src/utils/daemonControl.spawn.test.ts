import {describe, expect, it, vi} from 'vitest';

const spawnMock = vi.fn(() => ({pid: 1234, unref: vi.fn()}));
vi.mock('child_process', () => ({
	spawn: spawnMock,
}));

// Import after mock is set up
const {spawnDetachedDaemon} = await import('./daemonControl.js');

describe('spawnDetachedDaemon env isolation', () => {
	it('strips ARGUSDEV_DEV and ARGUSDEV_CONFIG_DIR from child env', () => {
		const originalEnv = {...process.env};
		process.env['ARGUSDEV_DEV'] = '1';
		process.env['ARGUSDEV_CONFIG_DIR'] = '/tmp/custom';

		spawnDetachedDaemon('/tmp/cli.js', 3000);

		expect(spawnMock).toHaveBeenCalledTimes(1);
		const spawnOpts = spawnMock.mock.calls[0]![2] as {
			env: Record<string, string | undefined>;
		};
		expect(spawnOpts.env['ARGUSDEV_DEV']).toBeUndefined();
		expect(spawnOpts.env['ARGUSDEV_CONFIG_DIR']).toBeUndefined();
		expect(spawnOpts.env['PATH']).toBeDefined();

		process.env = originalEnv;
	});
});
