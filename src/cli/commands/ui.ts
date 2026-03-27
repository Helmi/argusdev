import {ApiClientError, createApiClient} from '../apiClient.js';
import type {CliCommandContext} from '../types.js';

interface ApiMutationResponse {
	success: boolean;
}

interface UiActionContext {
	action: string | undefined;
	actionArgs: string[];
	commandLabel: string;
}

function normalizeApiError(error: unknown): Error {
	if (error instanceof ApiClientError) {
		if (error.status === 401 || error.status === 403) {
			return new Error(
				'Daemon API authentication failed. Verify local config token and daemon state.',
			);
		}

		if (error.message.includes('Unable to connect to ArgusDev daemon at')) {
			return new Error(
				'No running ArgusDev daemon found. Start it with `argusdev start`.',
			);
		}

		return new Error(error.message);
	}

	if (error instanceof Error) {
		return error;
	}

	return new Error(String(error));
}

function createDaemonApiClient(context: CliCommandContext) {
	return createApiClient({
		host: '127.0.0.1',
		port: context.port,
		accessToken: context.accessToken,
	});
}

async function postDaemonApi<T>(
	context: CliCommandContext,
	path: string,
	body: unknown,
): Promise<T> {
	try {
		const client = createDaemonApiClient(context);
		return await client.post<T>(path, body);
	} catch (error) {
		throw normalizeApiError(error);
	}
}

function resolveUiActionContext(context: CliCommandContext): UiActionContext {
	if (context.subcommand === 'ui' || context.subcommand === 'trigger') {
		const action = context.parsedArgs.input[1];
		return {
			action,
			actionArgs: context.parsedArgs.input.slice(2),
			commandLabel: action
				? `${context.subcommand} ${action}`
				: context.subcommand,
		};
	}

	return {
		action: context.subcommand,
		actionArgs: context.parsedArgs.input.slice(1),
		commandLabel: context.subcommand,
	};
}

function writeUsageError(
	context: CliCommandContext,
	commandLabel: string,
	usage: string,
	message: string,
): number {
	context.formatter.writeError({
		text: [`Error: ${message}`, `Usage: ${usage}`],
		data: {
			ok: false,
			command: commandLabel,
			error: {
				message,
				usage,
			},
		},
	});
	return 1;
}

function writeNotYetSupported(
	context: CliCommandContext,
	commandLabel: string,
	detail: string,
): number {
	const message = `${commandLabel} is not yet supported by daemon API`;
	context.formatter.writeError({
		text: [
			`Error: ${message}`,
			`Detail: ${detail}`,
			'No client-side orchestration was attempted.',
		],
		data: {
			ok: false,
			command: commandLabel,
			error: {
				message,
				detail,
				notSupportedByDaemonApi: true,
			},
		},
	});
	return 1;
}

async function runFocusCommand(
	context: CliCommandContext,
	commandLabel: string,
	actionArgs: string[],
): Promise<number> {
	const sessionId = actionArgs[0];
	if (!sessionId) {
		return writeUsageError(
			context,
			commandLabel,
			'argusdev focus <session-id>',
			'Missing session id',
		);
	}

	try {
		const response = await postDaemonApi<ApiMutationResponse>(
			context,
			'/api/session/set-active',
			{id: sessionId, isActive: true},
		);

		context.formatter.write({
			text: [`Focused session: ${sessionId}`],
			data: {
				ok: true,
				command: commandLabel,
				sessionId,
				success: response.success,
			},
		});
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		context.formatter.writeError({
			text: [`Failed to focus session ${sessionId}: ${message}`],
			data: {
				ok: false,
				command: commandLabel,
				error: {
					message,
					sessionId,
				},
			},
		});
		return 1;
	}
}

function runUnsupportedSendCommand(
	context: CliCommandContext,
	commandLabel: string,
	actionArgs: string[],
): number {
	const sessionId = actionArgs[0];
	const message = actionArgs.slice(1).join(' ').trim();
	if (!sessionId || !message) {
		return writeUsageError(
			context,
			commandLabel,
			'argusdev send <session-id> <message>',
			'Missing session id or message',
		);
	}

	return writeNotYetSupported(
		context,
		commandLabel,
		'No REST endpoint exists for sending terminal/session input (WebUI uses Socket.IO input events).',
	);
}

function runUnsupportedApproveCommand(
	context: CliCommandContext,
	commandLabel: string,
	actionArgs: string[],
): number {
	const sessionId = actionArgs[0];
	if (!sessionId) {
		return writeUsageError(
			context,
			commandLabel,
			'argusdev approve <session-id>',
			'Missing session id',
		);
	}

	return writeNotYetSupported(
		context,
		commandLabel,
		'No session-level approve endpoint exists in daemon API.',
	);
}

function runUnsupportedNotifyCommand(
	context: CliCommandContext,
	commandLabel: string,
	actionArgs: string[],
): number {
	const message = actionArgs.join(' ').trim();
	if (!message) {
		return writeUsageError(
			context,
			commandLabel,
			'argusdev notify <message>',
			'Missing notification message',
		);
	}

	return writeNotYetSupported(
		context,
		commandLabel,
		'No daemon API endpoint exists for posting arbitrary UI notifications.',
	);
}

function writeUiCommandHelp(context: CliCommandContext): number {
	context.formatter.writeError({
		text: [
			'Missing or unsupported UI action.',
			'Available commands:',
			'  argusdev ui send <session-id> <message>     (stub: not yet supported)',
			'  argusdev ui approve <session-id>            (stub: not yet supported)',
			'  argusdev ui focus <session-id>              (supported)',
			'  argusdev ui notify <message>                (stub: not yet supported)',
			'',
			'Aliases:',
			'  argusdev send ... | argusdev approve ... | argusdev focus ... | argusdev notify ...',
		],
		data: {
			ok: false,
			command: context.subcommand,
			error: {
				message: 'Missing or unsupported UI action',
				available: ['send', 'approve', 'focus', 'notify'],
			},
		},
	});
	return 1;
}

export async function runUiCommand(
	context: CliCommandContext,
): Promise<number> {
	const {action, actionArgs, commandLabel} = resolveUiActionContext(context);

	if (!action) {
		return writeUiCommandHelp(context);
	}

	if (action === 'focus') {
		return runFocusCommand(context, commandLabel, actionArgs);
	}

	if (action === 'send') {
		return runUnsupportedSendCommand(context, commandLabel, actionArgs);
	}

	if (action === 'approve') {
		return runUnsupportedApproveCommand(context, commandLabel, actionArgs);
	}

	if (action === 'notify') {
		return runUnsupportedNotifyCommand(context, commandLabel, actionArgs);
	}

	return writeUiCommandHelp(context);
}
