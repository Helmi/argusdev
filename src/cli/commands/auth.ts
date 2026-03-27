import * as readline from 'readline';
import {hashPasscode, validatePasscode} from '../../services/authService.js';
import {generateAccessToken} from '../../utils/wordlist.js';
import type {CliCommandContext} from '../types.js';

function askQuestion(question: string): Promise<string> {
	if (!process.stdin.isTTY) {
		return Promise.resolve('');
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => {
		rl.question(question, answer => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

async function askYesNo(question: string): Promise<boolean> {
	if (!process.stdin.isTTY) {
		return false;
	}
	const answer = await askQuestion(`${question} (y/N): `);
	return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

export async function runAuthCommand(
	context: CliCommandContext,
): Promise<number> {
	const authCommand = context.parsedArgs.input[1];
	const config = context.services.configurationManager.getConfiguration();
	const port = config.port ?? 3000;

	switch (authCommand) {
		case 'show': {
			if (!config.webEnabled) {
				context.formatter.write({
					text: [
						'Web interface is not enabled.',
						'Run `argusdev setup` to enable it.',
					],
					data: {
						ok: true,
						command: 'auth show',
						webEnabled: false,
					},
				});
				return 0;
			}

			if (!config.accessToken) {
				context.formatter.write({
					text: [
						'No access token configured.',
						'Run `argusdev auth regenerate-token` to generate one.',
					],
					data: {
						ok: true,
						command: 'auth show',
						webEnabled: true,
						accessTokenConfigured: false,
					},
				});
				return 0;
			}

			const lines = [
				'',
				'WebUI Access URL:',
				`  http://localhost:${port}/${config.accessToken}`,
				'',
			];
			if (!config.passcodeHash) {
				lines.push(
					'⚠️  No passcode set. Run `argusdev auth reset-passcode` to set one.',
				);
			} else {
				lines.push('✓ Passcode is configured');
			}

			context.formatter.write({
				text: lines,
				data: {
					ok: true,
					command: 'auth show',
					url: `http://localhost:${port}/${config.accessToken}`,
					accessTokenConfigured: true,
					passcodeConfigured: !!config.passcodeHash,
				},
			});
			return 0;
		}

		case 'reset-passcode': {
			if (!process.stdin.isTTY) {
				context.formatter.writeError({
					text: ['Error: reset-passcode requires an interactive terminal'],
					data: {
						ok: false,
						command: 'auth reset-passcode',
						error: {
							message: 'reset-passcode requires an interactive terminal',
						},
					},
				});
				return 1;
			}

			context.formatter.write({
				text: [
					'',
					'Set a new passcode for WebUI access (min 6 characters, alphanumeric):',
				],
				data: {
					ok: true,
					command: 'auth reset-passcode',
					state: 'prompting',
				},
			});

			let validPasscode = false;
			while (!validPasscode) {
				const passcode = await askQuestion('New passcode: ');
				const validation = validatePasscode(passcode);
				if (!validation.valid) {
					context.formatter.write({
						text: [`  Invalid: ${validation.error}`],
						data: {
							ok: false,
							command: 'auth reset-passcode',
							error: {
								message: validation.error,
							},
						},
					});
					continue;
				}

				const confirm = await askQuestion('Confirm passcode: ');
				if (passcode !== confirm) {
					context.formatter.write({
						text: ['  Passcodes do not match, try again.'],
						data: {
							ok: false,
							command: 'auth reset-passcode',
							error: {
								message: 'Passcodes do not match',
							},
						},
					});
					continue;
				}

				const hash = await hashPasscode(passcode);
				context.services.configurationManager.updateAuthCredentials({
					passcodeHash: hash,
				});
				context.formatter.write({
					text: ['', '✓ Passcode updated successfully'],
					data: {
						ok: true,
						command: 'auth reset-passcode',
						updated: true,
					},
				});
				validPasscode = true;
			}

			return 0;
		}

		case 'regenerate-token': {
			if (!process.stdin.isTTY) {
				context.formatter.writeError({
					text: ['Error: regenerate-token requires an interactive terminal'],
					data: {
						ok: false,
						command: 'auth regenerate-token',
						error: {
							message: 'regenerate-token requires an interactive terminal',
						},
					},
				});
				return 1;
			}

			context.formatter.write({
				text: [
					'',
					'⚠️  Warning: Regenerating the access token will:',
					'  - Invalidate your current access URL',
					'  - Require you to update any bookmarks',
					'',
				],
				data: {
					ok: true,
					command: 'auth regenerate-token',
					state: 'confirming',
				},
			});

			const proceed = await askYesNo('Continue?');
			if (!proceed) {
				context.formatter.write({
					text: ['Cancelled.'],
					data: {
						ok: true,
						command: 'auth regenerate-token',
						cancelled: true,
					},
				});
				return 0;
			}

			const newToken = generateAccessToken();
			context.services.configurationManager.updateAuthCredentials({
				accessToken: newToken,
			});

			context.formatter.write({
				text: [
					'',
					'✓ New access token generated',
					'',
					'New WebUI Access URL:',
					`  http://localhost:${port}/${newToken}`,
				],
				data: {
					ok: true,
					command: 'auth regenerate-token',
					url: `http://localhost:${port}/${newToken}`,
				},
			});
			return 0;
		}

		default:
			context.formatter.writeError({
				text: [
					authCommand
						? `Unknown auth command: ${authCommand}`
						: 'Missing auth command',
					'',
					'Available auth commands:',
					'  argusdev auth show              Display access URL',
					'  argusdev auth reset-passcode    Reset your passcode',
					'  argusdev auth regenerate-token  Generate new access token',
				],
				data: {
					ok: false,
					command: 'auth',
					error: {
						message: authCommand
							? `Unknown auth command: ${authCommand}`
							: 'Missing auth command',
						available: ['show', 'reset-passcode', 'regenerate-token'],
					},
				},
			});
			return 1;
	}
}
