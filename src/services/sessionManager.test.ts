import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {Effect, Either} from 'effect';
import {spawn, IPty} from 'node-pty';
import {EventEmitter} from 'events';
import {Session, DevcontainerConfig} from '../types/index.js';
import {exec, execFile} from 'child_process';
import {getDefaultShell} from '../utils/platform.js';
import {join} from 'path';
import {tmpdir} from 'os';
import {mkdtemp, rm, readFile} from 'fs/promises';
import * as startupScript from '../utils/startupScript.js';
import {
	STATE_CHECK_INTERVAL_MS,
	STATE_PERSISTENCE_DURATION_MS,
} from '../constants/statePersistence.js';

// Mock node-pty
vi.mock('node-pty', () => ({
	spawn: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
	exec: vi.fn(),
	execFile: vi.fn(),
}));

// Mock configuration manager
vi.mock('./configurationManager.js', () => ({
	configurationManager: {
		getCommandConfig: vi.fn(),
		getStatusHooks: vi.fn(() => ({})),
		getDefaultPreset: vi.fn(),
		getPresetById: vi.fn(),
		setWorktreeLastOpened: vi.fn(),
		getWorktreeLastOpenedTime: vi.fn(),
		getWorktreeLastOpened: vi.fn(() => ({})),
		isAutoApprovalEnabled: vi.fn(() => false),
		setAutoApprovalEnabled: vi.fn(),
	},
}));

// Mock Terminal
vi.mock('@xterm/headless', () => ({
	default: {
		Terminal: vi.fn().mockImplementation(() => ({
			buffer: {
				active: {
					length: 0,
					getLine: vi.fn(),
				},
			},
			write: vi.fn(),
		})),
	},
}));

// Mock worktreeService
vi.mock('./worktreeService.js', () => ({
	WorktreeService: vi.fn(),
}));

// Mock autoApprovalVerifier so handleAutoApproval doesn't make real subprocess calls.
// verifyNeedsPermission returns an Effect — mock it with Effect.succeed.
vi.mock('./autoApprovalVerifier.js', async () => {
	const {Effect} = await import('effect');
	return {
		autoApprovalVerifier: {
			verifyNeedsPermission: vi.fn(() =>
				Effect.succeed({needsPermission: false}),
			),
		},
	};
});

// Create a mock IPty class
class MockPty extends EventEmitter {
	kill = vi.fn();
	resize = vi.fn();
	write = vi.fn();
	onData = vi.fn((callback: (data: string) => void) => {
		this.on('data', callback);
	});
	onExit = vi.fn(
		(callback: (e: {exitCode: number; signal?: number}) => void) => {
			this.on('exit', callback);
		},
	);
}

describe('SessionManager', () => {
	let sessionManager: import('./sessionManager.js').SessionManager;
	let mockPty: MockPty;
	let SessionManager: typeof import('./sessionManager.js').SessionManager;
	let configurationManager: typeof import('./configurationManager.js').configurationManager;

	beforeEach(async () => {
		vi.clearAllMocks();
		// Dynamically import after mocks are set up
		const sessionManagerModule = await import('./sessionManager.js');
		const configManagerModule = await import('./configurationManager.js');
		SessionManager = sessionManagerModule.SessionManager;
		configurationManager = configManagerModule.configurationManager;
		sessionManager = new SessionManager();
		mockPty = new MockPty();

		// Default command lookup preflight to success.
		vi.mocked(execFile).mockImplementation((...params: unknown[]) => {
			const callback = params.find(param => typeof param === 'function') as
				| ((error: Error | null, stdout: string, stderr: string) => void)
				| undefined;
			callback?.(null, '/usr/bin/mock-agent\n', '');
			return {} as ReturnType<typeof execFile>;
		});
	});

	afterEach(() => {
		sessionManager.destroy();
	});

	describe('createSessionWithPresetEffect', () => {
		it('should use default preset when no preset ID specified', async () => {
			// Setup mock preset
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--preset-arg'],
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create session with preset
			await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);

			// Verify spawn was called with preset config
			expect(spawn).toHaveBeenCalledWith(
				'claude',
				['--preset-arg'],
				expect.any(Object),
			);
		});

		it('should use specific preset when ID provided', async () => {
			// Setup mock preset
			vi.mocked(configurationManager.getPresetById).mockReturnValue({
				id: '2',
				name: 'Development',
				command: 'claude',
				args: ['--resume', '--dev'],
				fallbackArgs: ['--no-mcp'],
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create session with specific preset
			await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree', '2'),
			);

			// Verify getPresetById was called with correct ID
			expect(configurationManager.getPresetById).toHaveBeenCalledWith('2');

			// Verify spawn was called with preset config
			expect(spawn).toHaveBeenCalledWith(
				'claude',
				['--resume', '--dev'],
				expect.any(Object),
			);
		});

		it('should fall back to default preset if specified preset not found', async () => {
			// Setup mocks
			vi.mocked(configurationManager.getPresetById).mockReturnValue(undefined);
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create session with non-existent preset
			await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect(
					'/test/worktree',
					'invalid',
				),
			);

			// Verify fallback to default preset
			expect(configurationManager.getDefaultPreset).toHaveBeenCalled();
			expect(spawn).toHaveBeenCalledWith('claude', [], expect.any(Object));
		});

		it('should throw error when spawn fails with preset', async () => {
			// Setup mock preset with fallback
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--bad-flag'],
				fallbackArgs: ['--good-flag'],
			});

			// Mock spawn to fail
			vi.mocked(spawn).mockImplementation(() => {
				throw new Error('Command failed');
			});

			// Expect createSessionWithPresetEffect to throw
			await expect(
				Effect.runPromise(
					sessionManager.createSessionWithPresetEffect('/test/worktree'),
				),
			).rejects.toThrow('Command failed');

			// Verify only one spawn attempt was made
			expect(spawn).toHaveBeenCalledTimes(1);
			expect(spawn).toHaveBeenCalledWith(
				'claude',
				['--bad-flag'],
				expect.any(Object),
			);
		});

		it('should allow multiple sessions for same worktree', async () => {
			// Setup mock preset
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create two sessions for the same worktree
			const session1 = await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);
			const session2 = await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);

			// Should create different sessions with unique IDs
			expect(session1.id).not.toBe(session2.id);
			// Both sessions should have the same worktree path
			expect(session1.worktreePath).toBe(session2.worktreePath);
			// Spawn should be called twice
			expect(spawn).toHaveBeenCalledTimes(2);
		});

		it('should throw error when spawn fails with fallback args', async () => {
			// Setup mock preset with fallback
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'nonexistent-command',
				args: ['--flag1'],
				fallbackArgs: ['--flag2'],
			});

			// Mock spawn to always throw error
			vi.mocked(spawn).mockImplementation(() => {
				throw new Error('Command not found');
			});

			// Expect createSessionWithPresetEffect to throw the original error
			await expect(
				Effect.runPromise(
					sessionManager.createSessionWithPresetEffect('/test/worktree'),
				),
			).rejects.toThrow('Command not found');
		});

		it('should use fallback args when main command exits with code 1', async () => {
			// Setup mock preset with fallback
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--invalid-flag'],
				fallbackArgs: ['--resume'],
			});

			// First spawn attempt - will exit with code 1
			const firstMockPty = new MockPty();
			// Second spawn attempt - succeeds
			const secondMockPty = new MockPty();

			vi.mocked(spawn)
				.mockReturnValueOnce(firstMockPty as unknown as IPty)
				.mockReturnValueOnce(secondMockPty as unknown as IPty);

			// Create session
			const session = await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);

			// Verify initial spawn
			expect(spawn).toHaveBeenCalledTimes(1);
			expect(spawn).toHaveBeenCalledWith(
				'claude',
				['--invalid-flag'],
				expect.objectContaining({cwd: '/test/worktree'}),
			);

			// Simulate exit with code 1 on first attempt
			firstMockPty.emit('exit', {exitCode: 1});

			// Wait for fallback to occur
			await new Promise(resolve => setTimeout(resolve, 50));

			// Verify fallback spawn was called
			expect(spawn).toHaveBeenCalledTimes(2);
			expect(spawn).toHaveBeenNthCalledWith(
				2,
				'claude',
				['--resume'],
				expect.objectContaining({cwd: '/test/worktree'}),
			);

			// Verify session process was replaced
			expect(session.process).toBe(secondMockPty);
			expect(session.isPrimaryCommand).toBe(false);
		});

		it('should not use fallback if main command succeeds', async () => {
			// Setup mock preset with fallback
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--resume'],
				fallbackArgs: ['--other-flag'],
			});

			// Setup spawn mock - process doesn't exit early
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create session
			await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);

			// Wait a bit to ensure no early exit
			await new Promise(resolve => setTimeout(resolve, 600));

			// Verify only one spawn attempt
			expect(spawn).toHaveBeenCalledTimes(1);
			expect(spawn).toHaveBeenCalledWith(
				'claude',
				['--resume'],
				expect.objectContaining({cwd: '/test/worktree'}),
			);
		});

		it('should use empty args as fallback when no fallback args specified', async () => {
			// Setup mock preset without fallback args
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--invalid-flag'],
				// No fallbackArgs
			});

			// First spawn attempt - will exit with code 1
			const firstMockPty = new MockPty();
			// Second spawn attempt - succeeds
			const secondMockPty = new MockPty();

			vi.mocked(spawn)
				.mockReturnValueOnce(firstMockPty as unknown as IPty)
				.mockReturnValueOnce(secondMockPty as unknown as IPty);

			// Create session
			const session = await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);

			// Verify initial spawn
			expect(spawn).toHaveBeenCalledTimes(1);
			expect(spawn).toHaveBeenCalledWith(
				'claude',
				['--invalid-flag'],
				expect.objectContaining({cwd: '/test/worktree'}),
			);

			// Simulate exit with code 1 on first attempt
			firstMockPty.emit('exit', {exitCode: 1});

			// Wait for fallback to occur
			await new Promise(resolve => setTimeout(resolve, 50));

			// Verify fallback spawn was called with empty args
			expect(spawn).toHaveBeenCalledTimes(2);
			expect(spawn).toHaveBeenNthCalledWith(
				2,
				'claude',
				[], // Empty args
				expect.objectContaining({cwd: '/test/worktree'}),
			);

			// Verify session process was replaced
			expect(session.process).toBe(secondMockPty);
			expect(session.isPrimaryCommand).toBe(false);
		});

		it('should handle custom command configuration', async () => {
			// Setup mock preset with custom command
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'my-custom-claude',
				args: ['--config', '/path/to/config'],
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create session
			await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);

			// Verify spawn was called with custom command
			expect(spawn).toHaveBeenCalledWith(
				'my-custom-claude',
				['--config', '/path/to/config'],
				expect.objectContaining({
					cwd: '/test/worktree',
				}),
			);
		});

		it('should throw error when spawn fails and no fallback configured', async () => {
			// Setup mock preset without fallback
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--invalid-flag'],
			});

			// Mock spawn to throw error
			vi.mocked(spawn).mockImplementation(() => {
				throw new Error('spawn failed');
			});

			// Expect createSessionWithPreset to throw
			await expect(
				Effect.runPromise(
					sessionManager.createSessionWithPresetEffect('/test/worktree'),
				),
			).rejects.toThrow('spawn failed');
		});
	});

	describe('buildBootstrapCommand', () => {
		const getBuildBootstrapCommand = (): ((
			shellCommand: string,
			command: string,
			args: string[],
			initialPrompt?: string,
			promptArg?: string,
		) => string) =>
			(
				Reflect.get(sessionManager, 'buildBootstrapCommand') as (
					shellCommand: string,
					command: string,
					args: string[],
					initialPrompt?: string,
					promptArg?: string,
				) => string
			).bind(sessionManager);

		it('should keep simple POSIX commands readable without extra quotes', () => {
			const buildBootstrapCommand = getBuildBootstrapCommand();
			const result = buildBootstrapCommand('/bin/zsh', 'claude', [
				'--resume',
				'--model=sonnet',
			]);

			expect(result).toBe('claude --resume --model=sonnet');
		});

		it('should quote unsafe POSIX tokens safely', () => {
			const buildBootstrapCommand = getBuildBootstrapCommand();
			const result = buildBootstrapCommand('/bin/zsh', 'claude', [
				'--message',
				'hello world',
				"it's done",
				'$(rm -rf /)',
				'',
			]);

			expect(result).toBe(
				"claude --message 'hello world' 'it'\"'\"'s done' '$(rm -rf /)' ''",
			);
		});

		it('should keep simple PowerShell commands readable without extra quotes', () => {
			const buildBootstrapCommand = getBuildBootstrapCommand();
			const result = buildBootstrapCommand('powershell.exe', 'claude', [
				'--resume',
				'--model=sonnet',
			]);

			expect(result).toBe('& claude --resume --model=sonnet');
		});

		it('should quote unsafe PowerShell tokens safely', () => {
			const buildBootstrapCommand = getBuildBootstrapCommand();
			const result = buildBootstrapCommand('pwsh', 'my tool', [
				'--message',
				"don't panic",
				'$env:PATH',
				'',
			]);

			expect(result).toBe(
				"& 'my tool' --message 'don''t panic' '$env:PATH' ''",
			);
		});

		it('should append startup prompt as positional argument by default', () => {
			const buildBootstrapCommand = getBuildBootstrapCommand();
			const result = buildBootstrapCommand(
				'/bin/zsh',
				'codex',
				['--model', 'gpt-5'],
				'hello world',
			);

			expect(result).toBe("codex --model gpt-5 'hello world'");
		});

		it('should append startup prompt using configured prompt flag', () => {
			const buildBootstrapCommand = getBuildBootstrapCommand();
			const result = buildBootstrapCommand(
				'/bin/zsh',
				'opencode',
				['-m', 'openai/gpt-5'],
				'review this',
				'--prompt',
			);

			expect(result).toBe("opencode -m openai/gpt-5 --prompt 'review this'");
		});

		it('should skip startup prompt injection when promptArg is none', () => {
			const buildBootstrapCommand = getBuildBootstrapCommand();
			const result = buildBootstrapCommand(
				'/bin/zsh',
				'terminal',
				['--login'],
				'should-not-be-included',
				'none',
			);

			expect(result).toBe('terminal --login');
		});
	});

	describe('createSessionWithAgentEffect', () => {
		it('should spawn a persistent shell and bootstrap the agent command', async () => {
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			await Effect.runPromise(
				sessionManager.createSessionWithAgentEffect(
					'/test/worktree',
					'claude',
					['--resume'],
					'claude',
					'Agent Session',
					'claude',
					{TEST_ENV: '1'},
					'agent',
				),
			);

			expect(spawn).toHaveBeenCalledWith(
				getDefaultShell(),
				[],
				expect.objectContaining({
					cwd: '/test/worktree',
					env: expect.objectContaining({TEST_ENV: '1'}),
				}),
			);

			expect(mockPty.write).toHaveBeenCalledTimes(1);
			const bootstrapCommand = mockPty.write.mock.calls[0]?.[0] as string;
			expect(bootstrapCommand.endsWith('\r')).toBe(true);
			expect(bootstrapCommand).toContain('claude');
			expect(bootstrapCommand).toContain('--resume');
			expect(bootstrapCommand).not.toContain("'claude'");
			expect(bootstrapCommand).not.toContain("'--resume'");
		});

		it('should prepend cwd when bootstrap option is enabled', async () => {
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			await Effect.runPromise(
				sessionManager.createSessionWithAgentEffect(
					'/test/worktree',
					'opencode',
					['-m', 'openai/gpt-5'],
					'claude',
					'Agent Session',
					'opencode',
					undefined,
					'agent',
					{prependCwd: true},
				),
			);

			const bootstrapCommand = mockPty.write.mock.calls[0]?.[0] as string;
			expect(bootstrapCommand).toContain('opencode . -m openai/gpt-5');
		});

		it('should keep terminal sessions as plain shells without bootstrap command', async () => {
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			await Effect.runPromise(
				sessionManager.createSessionWithAgentEffect(
					'/test/worktree',
					'ignored-for-terminal-kind',
					['--ignored'],
					undefined,
					undefined,
					'terminal',
					undefined,
					'terminal',
				),
			);

			expect(spawn).toHaveBeenCalledWith(
				getDefaultShell(),
				[],
				expect.objectContaining({cwd: '/test/worktree'}),
			);
			expect(mockPty.write).not.toHaveBeenCalled();
		});

		it.skipIf(process.platform === 'win32')(
			'should use launcher script for complex startup prompts',
			async () => {
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);
				vi.spyOn(
					sessionManager as unknown as {
						writePromptLauncherScript: (
							worktreePath: string,
							command: string,
							args: string[],
							initialPrompt: string,
							promptArg?: string,
						) => Promise<string>;
					},
					'writePromptLauncherScript',
				).mockResolvedValue('/tmp/.argusdev-startup-test.sh');

				await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'claude',
						[],
						'claude',
						'Agent Session',
						'claude',
						undefined,
						'agent',
						{
							initialPrompt: 'Line 1\nLine 2',
						},
					),
				);

				const bootstrapCommand = mockPty.write.mock.calls[0]?.[0] as string;
				expect(bootstrapCommand).toContain('bash');
				expect(bootstrapCommand).toContain('/tmp/.argusdev-startup-test.sh');
			},
		);

		it.skipIf(process.platform === 'win32')(
			'should add project cwd to launcher command for agents that prependCwd',
			async () => {
				const worktreePath = await mkdtemp(
					join(tmpdir(), 'argusdev-startup-worktree-'),
				);
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						worktreePath,
						'opencode',
						['-m', 'openai/gpt-5'],
						'claude',
						'Agent Session',
						'opencode',
						undefined,
						'agent',
						{
							initialPrompt: 'Line 1\nLine 2',
							promptArg: '--prompt',
							prependCwd: true,
						},
					),
				);

				const bootstrapCommand = mockPty.write.mock.calls[0]?.[0] as string;
				const scriptPath = bootstrapCommand
					.replace(/\r?\n?$/, '')
					.replace(/^bash\s+/, '');
				const scriptContent = await readFile(scriptPath, 'utf-8');
				expect(scriptContent).toContain(
					'opencode . -m openai/gpt-5 --prompt "$ARGUSDEV_PROMPT"',
				);

				await rm(worktreePath, {recursive: true, force: true});
			},
		);

		it.skipIf(process.platform === 'win32')(
			'should add startup script to git exclude when using launcher',
			async () => {
				const worktreePath = await mkdtemp(
					join(tmpdir(), 'argusdev-startup-worktree-'),
				);
				const ensureSpy = vi
					.spyOn(startupScript, 'ensureStartupScriptInGitExclude')
					.mockResolvedValue(true);
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						worktreePath,
						'claude',
						[],
						'claude',
						'Agent Session',
						'claude',
						undefined,
						'agent',
						{
							initialPrompt: 'Line 1\nLine 2',
						},
					),
				);

				const bootstrapCommand = mockPty.write.mock.calls[0]?.[0] as string;
				expect(bootstrapCommand).toContain('bash');
				expect(bootstrapCommand).toContain('.argusdev-startup-');
				expect(ensureSpy).toHaveBeenCalledTimes(1);
				const [registeredWorktreePath, launcherName] = ensureSpy.mock
					.calls[0] as [string, string];
				expect(registeredWorktreePath).toBe(worktreePath);
				expect(launcherName).toMatch(/\.argusdev-startup-.*\.sh/);

				await rm(worktreePath, {recursive: true, force: true});
			},
		);

		it.skipIf(process.platform === 'win32')(
			'should continue with session bootstrap when git exclude update fails',
			async () => {
				const worktreePath = await mkdtemp(
					join(tmpdir(), 'argusdev-startup-worktree-'),
				);
				const ensureSpy = vi
					.spyOn(startupScript, 'ensureStartupScriptInGitExclude')
					.mockResolvedValue(false);
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						worktreePath,
						'claude',
						[],
						'claude',
						'Agent Session',
						'agent',
						undefined,
						'agent',
						{
							initialPrompt: 'Line 1\nLine 2',
						},
					),
				);

				const bootstrapCommand = mockPty.write.mock.calls[0]?.[0] as string;
				expect(bootstrapCommand).toContain('bash');
				expect(bootstrapCommand).toContain('.argusdev-startup-');
				expect(ensureSpy).toHaveBeenCalledTimes(1);

				await rm(worktreePath, {recursive: true, force: true});
			},
		);

		it('should fail with ProcessError before shell bootstrap when agent command is missing', async () => {
			vi.mocked(execFile).mockImplementation((...params: unknown[]) => {
				const callback = params.find(param => typeof param === 'function') as
					| ((error: Error | null, stdout: string, stderr: string) => void)
					| undefined;
				callback?.(new Error('not found'), '', '');
				return {} as ReturnType<typeof execFile>;
			});

			const result = await Effect.runPromise(
				Effect.either(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'missing-agent',
						[],
						'claude',
						'Agent Session',
						'missing-agent',
						undefined,
						'agent',
						{
							initialPrompt: 'Line 1\nLine 2',
						},
					),
				),
			);

			expect(Either.isLeft(result)).toBe(true);
			if (Either.isLeft(result)) {
				expect(result.left._tag).toBe('ProcessError');
				if (result.left._tag === 'ProcessError') {
					expect(result.left.message).toContain(
						'Agent command "missing-agent" not found in PATH',
					);
				}
			}

			expect(spawn).not.toHaveBeenCalled();
			expect(mockPty.write).not.toHaveBeenCalled();
		});

		it.skipIf(process.platform === 'win32')(
			'should stop retrying prompt launcher after a launcher write failure',
			async () => {
				const firstPty = new MockPty();
				const secondPty = new MockPty();
				vi.mocked(spawn)
					.mockReturnValueOnce(firstPty as unknown as IPty)
					.mockReturnValueOnce(secondPty as unknown as IPty);

				const writePromptLauncherScriptSpy = vi
					.spyOn(
						sessionManager as unknown as {
							writePromptLauncherScript: (
								worktreePath: string,
								command: string,
								args: string[],
								initialPrompt: string,
								promptArg?: string,
							) => Promise<string>;
						},
						'writePromptLauncherScript',
					)
					.mockRejectedValue(new Error('disk full'));

				await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'claude',
						[],
						'claude',
						'Agent Session',
						'claude',
						undefined,
						'agent',
						{
							initialPrompt: 'Line 1\nLine 2',
						},
					),
				);

				await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'claude',
						[],
						'claude',
						'Agent Session 2',
						'claude',
						undefined,
						'agent',
						{
							initialPrompt: 'Line 1\nLine 2',
						},
					),
				);

				expect(writePromptLauncherScriptSpy).toHaveBeenCalledTimes(1);
				expect(firstPty.write).toHaveBeenCalledTimes(1);
				expect(secondPty.write).toHaveBeenCalledTimes(1);

				const firstBootstrap = firstPty.write.mock.calls[0]?.[0] as string;
				const secondBootstrap = secondPty.write.mock.calls[0]?.[0] as string;
				expect(firstBootstrap).toContain('claude');
				expect(secondBootstrap).toContain('claude');
				expect(firstBootstrap).not.toContain('Line 1');
				expect(secondBootstrap).not.toContain('Line 1');
			},
		);

		it('should honor sessionIdOverride for recovery flows', async () => {
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			const session = await Effect.runPromise(
				sessionManager.createSessionWithAgentEffect(
					'/test/worktree',
					'claude',
					['--resume'],
					'claude',
					'Recovered Session',
					'claude',
					undefined,
					'agent',
					{
						sessionIdOverride: 'session-recovered-1',
					},
				),
			);

			expect(session.id).toBe('session-recovered-1');
			expect(sessionManager.getSession('session-recovered-1')).toBeDefined();
		});
	});

	describe('session lifecycle', () => {
		it('should destroy session and clean up resources', async () => {
			// Setup
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
			});
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create session and get its ID
			const session = await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);

			// Destroy session using session ID
			sessionManager.destroySession(session.id);

			// Verify cleanup
			expect(mockPty.kill).toHaveBeenCalled();
			expect(sessionManager.getSession(session.id)).toBeUndefined();
		});

		it('should handle session exit event', async () => {
			// Setup
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
			});
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Track session exit event
			let exitedSession: Session | null = null;
			sessionManager.on('sessionExit', (session: Session) => {
				exitedSession = session;
			});

			// Create session
			const createdSession = await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);

			// Simulate process exit after successful creation
			setTimeout(() => {
				mockPty.emit('exit', {exitCode: 0});
			}, 600); // After early exit timeout

			// Wait for exit event
			await new Promise(resolve => setTimeout(resolve, 700));

			expect(exitedSession).toBe(createdSession);
			expect(sessionManager.getSession('/test/worktree')).toBeUndefined();
		});

		it('should rename an existing session and emit update event', async () => {
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
			});
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			const createdSession = await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect('/test/worktree'),
			);

			let updatedSession: {id: string; name?: string} | null = null;
			sessionManager.on('sessionUpdated', (session: Session) => {
				updatedSession = session;
			});

			const result = sessionManager.renameSession(
				createdSession.id,
				'Renamed Session',
			);

			expect(result).toBe(true);
			expect(createdSession.name).toBe('Renamed Session');
			expect(updatedSession).toMatchObject({
				id: createdSession.id,
				name: 'Renamed Session',
			});
		});

		it('should clear session name when renaming to empty string', async () => {
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
			});
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			const createdSession = await Effect.runPromise(
				sessionManager.createSessionWithPresetEffect(
					'/test/worktree',
					undefined,
					'Custom Name',
				),
			);

			const result = sessionManager.renameSession(createdSession.id, '   ');

			expect(result).toBe(true);
			expect(createdSession.name).toBeUndefined();
		});

		describe('applyHookStateEvent', () => {
			it('should transition state when hookBasedDetection is true', async () => {
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				const session = await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'codex',
						[],
						'codex',
						'Codex Session',
						'codex',
						undefined,
						'agent',
						{hookBasedDetection: true},
					),
				);

				expect(session.hookBasedDetection).toBe(true);
				expect(session.stateMutex.getSnapshot().state).toBe('idle');

				sessionManager.applyHookStateEvent(session.id, 'busy');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('busy');

				sessionManager.applyHookStateEvent(session.id, 'idle');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('idle');

				sessionManager.applyHookStateEvent(session.id, 'waiting_input');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('waiting_input');
			});

			it('should ignore hook events when hookBasedDetection is false', async () => {
				vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
					id: '1',
					name: 'Main',
					command: 'claude',
				});
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				const session = await Effect.runPromise(
					sessionManager.createSessionWithPresetEffect('/test/worktree'),
				);

				expect(session.hookBasedDetection).toBe(false);
				const stateBefore = session.stateMutex.getSnapshot().state;

				sessionManager.applyHookStateEvent(session.id, 'busy');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe(stateBefore);
			});

			it('should accept hook events when partialHookDetection is true', async () => {
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				const session = await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'pi',
						[],
						'pi',
						'Pi Session',
						'pi',
						undefined,
						'agent',
						{partialHookDetection: true},
					),
				);

				expect(session.partialHookDetection).toBe(true);
				expect(session.hookBasedDetection).toBe(false);
				expect(session.stateMutex.getSnapshot().state).toBe('idle');

				sessionManager.applyHookStateEvent(session.id, 'busy');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('busy');

				sessionManager.applyHookStateEvent(session.id, 'idle');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('idle');
			});

			it('PTY-detected idle must not overwrite hook-delivered busy for partial-hook sessions', async () => {
				// Regression for original P1: detectPiState returns idle when no spinner
				// is visible. A fast tool_call (hook → busy) followed by a poll cycle must
				// NOT clobber the busy state via PTY-detected idle.
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				const session = await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'pi',
						[],
						'pi',
						'Pi Partial Hook Session',
						'pi',
						undefined,
						'agent',
						{partialHookDetection: true},
					),
				);

				// Hook fires turn_start/tool_call → busy
				sessionManager.applyHookStateEvent(session.id, 'busy');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('busy');

				// Wait for multiple poll cycles. The mocked terminal has no spinner so
				// detectPiState returns idle — the guard must drop PTY-idle and leave
				// hook-delivered busy in place.
				await new Promise(resolve =>
					setTimeout(resolve, STATE_CHECK_INTERVAL_MS * 3 + 50),
				);
				expect(session.stateMutex.getSnapshot().state).toBe('busy');
			});

			it('turn_start hook delivers busy for pure-thinking turns (no tool_call)', async () => {
				// Pure-thinking turns: model generates text without calling a tool.
				// No tool_call fires, so busy must come from turn_start.
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				const session = await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'pi',
						[],
						'pi',
						'Pi Thinking Session',
						'pi',
						undefined,
						'agent',
						{partialHookDetection: true},
					),
				);

				expect(session.stateMutex.getSnapshot().state).toBe('idle');

				// turn_start fires → hook POSTs busy (same path as tool_call)
				sessionManager.applyHookStateEvent(session.id, 'busy');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('busy');

				// agent_end fires → hook POSTs idle
				sessionManager.applyHookStateEvent(session.id, 'idle');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('idle');
			});

			it('should call hookCleanup on session exit', async () => {
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				const cleanup = vi.fn();
				await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'codex',
						[],
						'codex',
						'Codex Session',
						'codex',
						undefined,
						'agent',
						{hookBasedDetection: true, hookCleanup: cleanup},
					),
				);

				setTimeout(() => {
					mockPty.emit('exit', {exitCode: 0});
				}, 600);

				await new Promise(resolve => setTimeout(resolve, 700));
				expect(cleanup).toHaveBeenCalledOnce();
			});

			it('hook-delivered waiting_input triggers auto-approval when enabled (gap 1)', async () => {
				// Regression: applyHookStateEvent converts waiting_input → pending_auto_approval
				// when auto-approval is enabled, but handleAutoApproval was never called for
				// hook-based sessions (only reachable from polling loop). Fix: call after state update.
				// Verifier mock returns needsPermission:false → auto-approve → state ends at busy.
				vi.mocked(configurationManager.isAutoApprovalEnabled).mockReturnValue(
					true,
				);
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				const session = await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'codex',
						[],
						'codex',
						'Codex Session',
						'codex',
						undefined,
						'agent',
						{hookBasedDetection: true},
					),
				);

				expect(session.stateMutex.getSnapshot().state).toBe('idle');

				sessionManager.applyHookStateEvent(session.id, 'waiting_input');
				// Allow state update → pending_auto_approval → handleAutoApproval → verifier → busy
				await new Promise(resolve => setTimeout(resolve, 100));

				// Auto-approval succeeded (verifier mock: needsPermission=false) → state is busy.
				// If handleAutoApproval were never called (the pre-fix bug), state would stay at
				// waiting_input because nothing drives the pending_auto_approval → busy transition.
				expect(session.stateMutex.getSnapshot().state).toBe('busy');
				expect(mockPty.write).toHaveBeenCalledWith('\r');
			});

			it('PTY-detected busy transitions partial-hook session out of waiting_input (gap 2)', async () => {
				// Regression: Pi session in waiting_input (user answered prompt). Tool resumes,
				// spinner appears in PTY, but no new turn_start/tool_call hook fires for the
				// same in-flight action. Old guard dropped PTY-busy → session stuck on
				// waiting_input. Fix: allow PTY through when oldState is waiting_input.
				vi.mocked(configurationManager.isAutoApprovalEnabled).mockReturnValue(
					false,
				);
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				const session = await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'pi',
						[],
						'pi',
						'Pi Session',
						'pi',
						undefined,
						'agent',
						{partialHookDetection: true},
					),
				);

				// Hook delivers waiting_input (permission prompt appeared)
				sessionManager.applyHookStateEvent(session.id, 'waiting_input');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('waiting_input');

				// Now mock the terminal to show a Pi-style spinner (busy) — simulates user
				// answering and tool resuming. Pi detectState looks for braille + "working..."
				const busyLine = {translateToString: vi.fn(() => '⠸ working...')};
				vi.mocked(session.terminal.buffer.active.getLine).mockReturnValue(
					busyLine as unknown as ReturnType<
						typeof session.terminal.buffer.active.getLine
					>,
				);
				Object.defineProperty(session.terminal.buffer.active, 'length', {
					value: 1,
					configurable: true,
				});

				// Wait for polling to pick up PTY-busy and persist it (STATE_PERSISTENCE_DURATION_MS
				// must elapse while busy is consistently detected before state commits).
				await new Promise(resolve =>
					setTimeout(
						resolve,
						STATE_PERSISTENCE_DURATION_MS + STATE_CHECK_INTERVAL_MS * 3,
					),
				);
				expect(session.stateMutex.getSnapshot().state).toBe('busy');
			});

			it('PTY-idle must not clobber hook-delivered waiting_input in partial-hook sessions', async () => {
				// Regression for the asymmetric guard: when Pi's detector returns idle
				// (no spinner, no prompt regex match — the default), PTY must NOT commit
				// idle over hook-delivered waiting_input. A flickering or partially-rendered
				// prompt would otherwise hide the required user action and cancel any
				// in-flight auto-approval verification.
				vi.mocked(configurationManager.isAutoApprovalEnabled).mockReturnValue(
					false,
				);
				vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

				const session = await Effect.runPromise(
					sessionManager.createSessionWithAgentEffect(
						'/test/worktree',
						'pi',
						[],
						'pi',
						'Pi Session',
						'pi',
						undefined,
						'agent',
						{partialHookDetection: true},
					),
				);

				// Hook delivers waiting_input (permission prompt appeared)
				sessionManager.applyHookStateEvent(session.id, 'waiting_input');
				await new Promise(resolve => setTimeout(resolve, 10));
				expect(session.stateMutex.getSnapshot().state).toBe('waiting_input');

				// Terminal buffer is empty — Pi's detector returns idle (default when no match).
				// The guard must drop this PTY signal and leave waiting_input in place.

				// Wait well past STATE_PERSISTENCE_DURATION_MS to let any erroneous
				// idle transition commit if the guard is broken.
				await new Promise(resolve =>
					setTimeout(
						resolve,
						STATE_PERSISTENCE_DURATION_MS + STATE_CHECK_INTERVAL_MS * 3,
					),
				);
				expect(session.stateMutex.getSnapshot().state).toBe('waiting_input');
			});
		});
	});

	describe('createSessionWithDevcontainerEffect', () => {
		beforeEach(() => {
			// Reset shouldFail flag
			const mockExec = vi.mocked(exec) as ReturnType<typeof vi.fn> & {
				shouldFail?: boolean;
			};
			mockExec.shouldFail = false;

			// Setup exec mock to work with promisify
			mockExec.mockImplementation(((...args: unknown[]) => {
				const [command, , callback] = args as [
					string,
					unknown,
					((err: Error | null, stdout?: string, stderr?: string) => void)?,
				];
				if (callback) {
					// Handle callback style
					if (command.includes('devcontainer up')) {
						if (mockExec.shouldFail) {
							callback(new Error('Container startup failed'));
						} else {
							callback(null, '', '');
						}
					}
				}
			}) as Parameters<typeof mockExec.mockImplementation>[0]);
		});

		it('should execute devcontainer up command before creating session', async () => {
			// Setup mock preset
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--resume'],
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create session with devcontainer
			const devcontainerConfig = {
				upCommand: 'devcontainer up --workspace-folder .',
				execCommand: 'devcontainer exec --workspace-folder .',
			};

			await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect(
					'/test/worktree',
					devcontainerConfig,
				),
			);

			// Verify spawn was called correctly which proves devcontainer up succeeded

			// Verify spawn was called with devcontainer exec
			expect(spawn).toHaveBeenCalledWith(
				'devcontainer',
				['exec', '--workspace-folder', '.', '--', 'claude', '--resume'],
				expect.objectContaining({cwd: '/test/worktree'}),
			);
		});

		it('should use specific preset when ID provided', async () => {
			// Setup mock preset
			vi.mocked(configurationManager.getPresetById).mockReturnValue({
				id: '2',
				name: 'Development',
				command: 'claude',
				args: ['--resume', '--dev'],
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create session with devcontainer and specific preset
			const devcontainerConfig = {
				upCommand: 'devcontainer up',
				execCommand: 'devcontainer exec',
			};

			await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect(
					'/test/worktree',
					devcontainerConfig,
					'2',
				),
			);

			// Verify correct preset was used
			expect(configurationManager.getPresetById).toHaveBeenCalledWith('2');
			expect(spawn).toHaveBeenCalledWith(
				'devcontainer',
				['exec', '--', 'claude', '--resume', '--dev'],
				expect.any(Object),
			);
		});

		it('should throw error when devcontainer up fails', async () => {
			// Setup exec to fail
			const mockExec = vi.mocked(exec) as ReturnType<typeof vi.fn> & {
				shouldFail?: boolean;
			};
			mockExec.shouldFail = true;

			// Create session with devcontainer
			const devcontainerConfig = {
				upCommand: 'devcontainer up',
				execCommand: 'devcontainer exec',
			};

			await expect(
				Effect.runPromise(
					sessionManager.createSessionWithDevcontainerEffect(
						'/test/worktree',
						devcontainerConfig,
					),
				),
			).rejects.toThrow(
				'Failed to start devcontainer: Container startup failed',
			);
		});

		it('should allow multiple sessions for same worktree with devcontainer', async () => {
			// Setup mock preset
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			const devcontainerConfig = {
				upCommand: 'devcontainer up',
				execCommand: 'devcontainer exec',
			};

			// Create two sessions for the same worktree
			const session1 = await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect(
					'/test/worktree',
					devcontainerConfig,
				),
			);
			const session2 = await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect(
					'/test/worktree',
					devcontainerConfig,
				),
			);

			// Should create different sessions with unique IDs
			expect(session1.id).not.toBe(session2.id);
			// Both sessions should have the same worktree path
			expect(session1.worktreePath).toBe(session2.worktreePath);
			// spawn should be called twice
			expect(spawn).toHaveBeenCalledTimes(2);
		});

		it('should handle complex exec commands with multiple arguments', async () => {
			// Setup mock preset
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--model', 'opus'],
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			// Create session with complex exec command
			const devcontainerConfig = {
				upCommand: 'devcontainer up --workspace-folder . --log-level debug',
				execCommand:
					'devcontainer exec --workspace-folder . --container-name mycontainer',
			};

			await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect(
					'/test/worktree',
					devcontainerConfig,
				),
			);

			// Verify spawn was called with properly parsed exec command
			expect(spawn).toHaveBeenCalledWith(
				'devcontainer',
				[
					'exec',
					'--workspace-folder',
					'.',
					'--container-name',
					'mycontainer',
					'--',
					'claude',
					'--model',
					'opus',
				],
				expect.any(Object),
			);
		});

		it('should spawn process with devcontainer exec command', async () => {
			// Create a new session manager and reset mocks
			vi.clearAllMocks();
			sessionManager = new SessionManager();

			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: [],
			});

			// Setup spawn mock
			vi.mocked(spawn).mockReturnValue(mockPty as unknown as IPty);

			type MockExecParams = Parameters<typeof exec>;
			const mockExec = vi.mocked(exec);
			mockExec.mockImplementation(
				(
					cmd: MockExecParams[0],
					options: MockExecParams[1],
					callback?: MockExecParams[2],
				) => {
					if (typeof options === 'function') {
						callback = options as MockExecParams[2];
						options = undefined;
					}
					if (callback && typeof callback === 'function') {
						callback(null, 'Container started', '');
					}
					return {} as ReturnType<typeof exec>;
				},
			);

			await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect('/test/worktree2', {
					upCommand: 'devcontainer up --workspace-folder .',
					execCommand: 'devcontainer exec --workspace-folder .',
				}),
			);

			// Should spawn with devcontainer exec command
			expect(spawn).toHaveBeenCalledWith(
				'devcontainer',
				['exec', '--workspace-folder', '.', '--', 'claude'],
				expect.objectContaining({
					cwd: '/test/worktree2',
				}),
			);
		});

		it('should use preset with devcontainer', async () => {
			type MockExecParams = Parameters<typeof exec>;
			const mockExec = vi.mocked(exec);
			mockExec.mockImplementation(
				(
					cmd: MockExecParams[0],
					options: MockExecParams[1],
					callback?: MockExecParams[2],
				) => {
					if (typeof options === 'function') {
						callback = options as MockExecParams[2];
						options = undefined;
					}
					if (callback && typeof callback === 'function') {
						callback(null, 'Container started', '');
					}
					return {} as ReturnType<typeof exec>;
				},
			);

			const session = await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect(
					'/test/worktree',
					{
						upCommand: 'devcontainer up --workspace-folder .',
						execCommand: 'devcontainer exec --workspace-folder .',
					},
					'custom-preset',
				),
			);

			// Verify session was created with correct devcontainer config
			expect(session).toBeDefined();
			expect(session.devcontainerConfig).toEqual({
				upCommand: 'devcontainer up --workspace-folder .',
				execCommand: 'devcontainer exec --workspace-folder .',
			});
		});

		it('should parse exec command and append preset command', async () => {
			type MockExecParams = Parameters<typeof exec>;
			const mockExec = vi.mocked(exec);
			mockExec.mockImplementation(
				(
					cmd: MockExecParams[0],
					options: MockExecParams[1],
					callback?: MockExecParams[2],
				) => {
					if (typeof options === 'function') {
						callback = options as MockExecParams[2];
						options = undefined;
					}
					if (callback && typeof callback === 'function') {
						callback(null, 'Container started', '');
					}
					return {} as ReturnType<typeof exec>;
				},
			);

			const config: DevcontainerConfig = {
				upCommand: 'devcontainer up --workspace-folder /path/to/project',
				execCommand:
					'devcontainer exec --workspace-folder /path/to/project --user vscode',
			};

			await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect(
					'/test/worktree',
					config,
				),
			);

			expect(spawn).toHaveBeenCalledWith(
				'devcontainer',
				[
					'exec',
					'--workspace-folder',
					'/path/to/project',
					'--user',
					'vscode',
					'--',
					'claude',
				],
				expect.any(Object),
			);
		});

		it('should handle preset with args in devcontainer', async () => {
			type MockExecParams = Parameters<typeof exec>;
			const mockExec = vi.mocked(exec);
			mockExec.mockImplementation(
				(
					cmd: MockExecParams[0],
					options: MockExecParams[1],
					callback?: MockExecParams[2],
				) => {
					if (typeof options === 'function') {
						callback = options as MockExecParams[2];
						options = undefined;
					}
					if (callback && typeof callback === 'function') {
						callback(null, 'Container started', '');
					}
					return {} as ReturnType<typeof exec>;
				},
			);

			vi.mocked(configurationManager.getPresetById).mockReturnValue({
				id: 'claude-with-args',
				name: 'Claude with Args',
				command: 'claude',
				args: ['-m', 'claude-3-opus'],
			});

			await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect(
					'/test/worktree',
					{
						upCommand: 'devcontainer up --workspace-folder .',
						execCommand: 'devcontainer exec --workspace-folder .',
					},
					'claude-with-args',
				),
			);

			expect(spawn).toHaveBeenCalledWith(
				'devcontainer',
				[
					'exec',
					'--workspace-folder',
					'.',
					'--',
					'claude',
					'-m',
					'claude-3-opus',
				],
				expect.any(Object),
			);
		});

		it('should use empty args as fallback in devcontainer when no fallback args specified', async () => {
			// Setup exec mock for devcontainer up
			type MockExecParams = Parameters<typeof exec>;
			const mockExec = vi.mocked(exec);
			mockExec.mockImplementation(
				(
					cmd: MockExecParams[0],
					options: MockExecParams[1],
					callback?: MockExecParams[2],
				) => {
					if (typeof options === 'function') {
						callback = options as MockExecParams[2];
						options = undefined;
					}
					if (callback && typeof callback === 'function') {
						callback(null, 'Container started', '');
					}
					return {} as ReturnType<typeof exec>;
				},
			);

			// Setup preset without fallback args
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--invalid-flag'],
				// No fallbackArgs
			});

			// First spawn attempt - will exit with code 1
			const firstMockPty = new MockPty();
			// Second spawn attempt - succeeds
			const secondMockPty = new MockPty();

			vi.mocked(spawn)
				.mockReturnValueOnce(firstMockPty as unknown as IPty)
				.mockReturnValueOnce(secondMockPty as unknown as IPty);

			const session = await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect('/test/worktree', {
					upCommand: 'devcontainer up --workspace-folder .',
					execCommand: 'devcontainer exec --workspace-folder .',
				}),
			);

			// Verify initial spawn
			expect(spawn).toHaveBeenCalledTimes(1);
			expect(spawn).toHaveBeenCalledWith(
				'devcontainer',
				['exec', '--workspace-folder', '.', '--', 'claude', '--invalid-flag'],
				expect.objectContaining({cwd: '/test/worktree'}),
			);

			// Simulate exit with code 1 on first attempt
			firstMockPty.emit('exit', {exitCode: 1});

			// Wait for fallback to occur
			await new Promise(resolve => setTimeout(resolve, 50));

			// Verify fallback spawn was called with empty args
			expect(spawn).toHaveBeenCalledTimes(2);
			expect(spawn).toHaveBeenNthCalledWith(
				2,
				'devcontainer',
				['exec', '--workspace-folder', '.', '--', 'claude'], // No args after claude
				expect.objectContaining({cwd: '/test/worktree'}),
			);

			// Verify session process was replaced
			expect(session.process).toBe(secondMockPty);
			expect(session.isPrimaryCommand).toBe(false);
		});

		it('should use fallback args in devcontainer when primary command exits with code 1', async () => {
			// Setup exec mock for devcontainer up
			type MockExecParams = Parameters<typeof exec>;
			const mockExec = vi.mocked(exec);
			mockExec.mockImplementation(
				(
					cmd: MockExecParams[0],
					options: MockExecParams[1],
					callback?: MockExecParams[2],
				) => {
					if (typeof options === 'function') {
						callback = options as MockExecParams[2];
						options = undefined;
					}
					if (callback && typeof callback === 'function') {
						callback(null, 'Container started', '');
					}
					return {} as ReturnType<typeof exec>;
				},
			);

			// Setup preset with fallback
			vi.mocked(configurationManager.getDefaultPreset).mockReturnValue({
				id: '1',
				name: 'Main',
				command: 'claude',
				args: ['--bad-flag'],
				fallbackArgs: ['--good-flag'],
			});

			// First spawn attempt - will exit with code 1
			const firstMockPty = new MockPty();
			// Second spawn attempt - succeeds
			const secondMockPty = new MockPty();

			vi.mocked(spawn)
				.mockReturnValueOnce(firstMockPty as unknown as IPty)
				.mockReturnValueOnce(secondMockPty as unknown as IPty);

			const session = await Effect.runPromise(
				sessionManager.createSessionWithDevcontainerEffect('/test/worktree', {
					upCommand: 'devcontainer up --workspace-folder .',
					execCommand: 'devcontainer exec --workspace-folder .',
				}),
			);

			// Verify initial spawn
			expect(spawn).toHaveBeenCalledTimes(1);
			expect(spawn).toHaveBeenCalledWith(
				'devcontainer',
				['exec', '--workspace-folder', '.', '--', 'claude', '--bad-flag'],
				expect.objectContaining({cwd: '/test/worktree'}),
			);

			// Simulate exit with code 1 on first attempt
			firstMockPty.emit('exit', {exitCode: 1});

			// Wait for fallback to occur
			await new Promise(resolve => setTimeout(resolve, 50));

			// Verify fallback spawn was called
			expect(spawn).toHaveBeenCalledTimes(2);
			expect(spawn).toHaveBeenNthCalledWith(
				2,
				'devcontainer',
				['exec', '--workspace-folder', '.', '--', 'claude', '--good-flag'],
				expect.objectContaining({cwd: '/test/worktree'}),
			);

			// Verify session process was replaced
			expect(session.process).toBe(secondMockPty);
			expect(session.isPrimaryCommand).toBe(false);
		});
	});

	describe('static methods', () => {
		describe('getSessionCounts', () => {
			// Helper to create mock session with stateMutex
			const createMockSession = (
				id: string,
				state: 'idle' | 'busy' | 'waiting_input' | 'pending_auto_approval',
			): Partial<Session> => ({
				id,
				stateMutex: {
					getSnapshot: () => ({state}),
				} as Session['stateMutex'],
			});

			it('should count sessions by state', () => {
				const sessions = [
					createMockSession('1', 'idle'),
					createMockSession('2', 'busy'),
					createMockSession('3', 'busy'),
					createMockSession('4', 'waiting_input'),
					createMockSession('5', 'idle'),
				];

				const counts = SessionManager.getSessionCounts(sessions as Session[]);

				expect(counts.idle).toBe(2);
				expect(counts.busy).toBe(2);
				expect(counts.waiting_input).toBe(1);
				expect(counts.total).toBe(5);
			});

			it('should handle empty sessions array', () => {
				const counts = SessionManager.getSessionCounts([]);

				expect(counts.idle).toBe(0);
				expect(counts.busy).toBe(0);
				expect(counts.waiting_input).toBe(0);
				expect(counts.total).toBe(0);
			});

			it('should handle sessions with single state', () => {
				const sessions = [
					createMockSession('1', 'busy'),
					createMockSession('2', 'busy'),
					createMockSession('3', 'busy'),
				];

				const counts = SessionManager.getSessionCounts(sessions as Session[]);

				expect(counts.idle).toBe(0);
				expect(counts.busy).toBe(3);
				expect(counts.waiting_input).toBe(0);
				expect(counts.total).toBe(3);
			});
		});

		describe('formatSessionCounts', () => {
			it('should format counts with all states', () => {
				const counts = {
					idle: 1,
					busy: 2,
					waiting_input: 1,
					pending_auto_approval: 0,
					total: 4,
				};

				const formatted = SessionManager.formatSessionCounts(counts);

				expect(formatted).toBe(' (1 Idle / 2 Busy / 1 Waiting)');
			});

			it('should format counts with some states', () => {
				const counts = {
					idle: 2,
					busy: 0,
					waiting_input: 1,
					pending_auto_approval: 0,
					total: 3,
				};

				const formatted = SessionManager.formatSessionCounts(counts);

				expect(formatted).toBe(' (2 Idle / 1 Waiting)');
			});

			it('should format counts with single state', () => {
				const counts = {
					idle: 0,
					busy: 3,
					waiting_input: 0,
					pending_auto_approval: 0,
					total: 3,
				};

				const formatted = SessionManager.formatSessionCounts(counts);

				expect(formatted).toBe(' (3 Busy)');
			});

			it('should return empty string for zero sessions', () => {
				const counts = {
					idle: 0,
					busy: 0,
					waiting_input: 0,
					pending_auto_approval: 0,
					total: 0,
				};

				const formatted = SessionManager.formatSessionCounts(counts);

				expect(formatted).toBe('');
			});
		});
	});
});
