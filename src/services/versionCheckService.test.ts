import {
	afterEach,
	describe,
	expect,
	it,
	beforeEach,
	vi,
} from 'vitest'
import {UPDATE_CHECK_TTL_MS} from '../constants/env.js'

const mockGetUpdateCheck = vi.fn()
const mockSetUpdateCheck = vi.fn()
const mockFetch = vi.fn()

vi.mock('./configurationManager.js', () => ({
	configurationManager: {
		getUpdateCheck: mockGetUpdateCheck,
		setUpdateCheck: mockSetUpdateCheck,
	},
}))

type VersionCheckService = typeof import('./versionCheckService.js')
let versionCheckService: VersionCheckService
let originalFetch: typeof fetch
let originalNodeEnv: string | undefined

describe('versionCheckService', () => {
	beforeEach(async () => {
		originalNodeEnv = process.env['NODE_ENV']
		process.env['NODE_ENV'] = 'production'

		mockGetUpdateCheck.mockReset()
		mockSetUpdateCheck.mockReset()
		mockFetch.mockReset()

		originalFetch = globalThis.fetch
		globalThis.fetch = mockFetch as unknown as typeof fetch
		vi.resetModules()
		versionCheckService = await import('./versionCheckService.js')
	})

	afterEach(() => {
		process.env['NODE_ENV'] = originalNodeEnv
		globalThis.fetch = originalFetch
	})

	it('returns cache when fresh and avoids network', async () => {
		const currentVersion = versionCheckService.getCurrentVersionString()
		mockGetUpdateCheck.mockReturnValue({
			checkedAt: Date.now(),
			latestVersion: currentVersion,
			latestTag: currentVersion,
		})

		const result = await versionCheckService.checkForUpdate()

		expect(result.source).toBe('cache')
		expect(result.isUpdateAvailable).toBe(false)
		expect(mockFetch).not.toHaveBeenCalled()
	})

	it('rechecks stale cache and persists successful network result', async () => {
		const staleTimestamp = Date.now() - UPDATE_CHECK_TTL_MS - 1
		mockGetUpdateCheck.mockReturnValue({
			checkedAt: staleTimestamp,
			latestVersion: '0.0.1',
			latestTag: '0.0.1',
		})
		mockFetch.mockResolvedValue({
			ok: true,
			statusText: 'OK',
			status: 200,
			json: vi.fn(async () => ({tag_name: 'v999.0.0'})),
		} as unknown as Response)

		const result = await versionCheckService.checkForUpdate()

		expect(mockFetch).toHaveBeenCalledOnce()
		expect(mockSetUpdateCheck).toHaveBeenCalledWith({
			checkedAt: expect.any(Number),
			latestVersion: '999.0.0',
			latestTag: '999.0.0',
		})
		expect(result.isUpdateAvailable).toBe(true)
	})

	it('returns cached result when network fails and keeps stale data', async () => {
		const staleTimestamp = Date.now() - UPDATE_CHECK_TTL_MS - 1
		mockGetUpdateCheck.mockReturnValue({
			checkedAt: staleTimestamp,
			latestVersion: '0.0.1',
			latestTag: '0.0.1',
		})
		mockFetch.mockRejectedValue(new Error('network down'))

		const result = await versionCheckService.checkForUpdate()

		expect(result.source).toBe('cache')
		expect(result.error).toContain('network down')
		expect(result.isUpdateAvailable).toBe(false)
		expect(mockSetUpdateCheck).not.toHaveBeenCalled()
	})

	it('persists error state when no cached value exists and network fails', async () => {
		mockGetUpdateCheck.mockReturnValue(undefined)
		mockFetch.mockRejectedValue(new Error('dns failure'))

		const result = await versionCheckService.checkForUpdate()

		expect(result.source).toBe('network')
		expect(result.error).toContain('dns failure')
		expect(mockSetUpdateCheck).toHaveBeenCalledWith(
			expect.objectContaining({
				checkedAt: expect.any(Number),
				latestVersionError: expect.stringContaining('dns failure'),
			}),
		)
	})

	it('reads cached update check data from configuration', () => {
		mockGetUpdateCheck.mockReturnValue({
			checkedAt: Date.now(),
			latestVersion: 'v2.0.0',
			latestTag: 'v2.0.0',
		})

		const result = versionCheckService.getCachedUpdateCheck()
		expect(result?.source).toBe('cache')
		expect(result?.latestVersion).toBe('2.0.0')
	})

	it('propagates cached update-check errors', () => {
		mockGetUpdateCheck.mockReturnValue({
			checkedAt: Date.now(),
			latestVersionError: 'rate limit',
		})

		const result = versionCheckService.getCachedUpdateCheck()
		expect(result?.source).toBe('cache')
		expect(result?.error).toContain('rate limit')
	})
})
