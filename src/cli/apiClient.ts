/* global Response */
import {existsSync, readFileSync} from 'fs';
import {join} from 'path';
import {ENV_VARS} from '../constants/env.js';
import {getConfigDir} from '../utils/configDir.js';
import type {ConfigurationData} from '../types/index.js';

const DEFAULT_API_PORT = 3000;
const DEFAULT_TIMEOUT_MS = 5000;

function parsePort(portValue: string | undefined): number | undefined {
	if (!portValue) {
		return undefined;
	}

	const parsed = Number.parseInt(portValue, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		return undefined;
	}

	return parsed;
}

function loadConfigForApiClient(): Partial<ConfigurationData> {
	try {
		const configDir = getConfigDir();
		const configPath = join(configDir, 'config.json');
		if (!existsSync(configPath)) {
			return {};
		}
		const raw = readFileSync(configPath, 'utf-8');
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') {
			return {};
		}
		return parsed as Partial<ConfigurationData>;
	} catch {
		// Be permissive for CLI startup paths; callers can still override via options/env.
		return {};
	}
}

export interface ResolvedDaemonApiConfig {
	baseUrl: string;
	port: number;
	accessToken?: string;
}

export interface ResolveDaemonApiConfigOptions {
	config?: ConfigurationData;
	env?: NodeJS.ProcessEnv;
	host?: string;
	port?: number;
	accessToken?: string;
}

export function resolveDaemonApiConfig(
	options: ResolveDaemonApiConfigOptions = {},
): ResolvedDaemonApiConfig {
	const config = options.config ?? loadConfigForApiClient();
	const env = options.env ?? process.env;
	const host = options.host ?? 'localhost';
	const resolvedPort =
		options.port ??
		parsePort(env[ENV_VARS.PORT]) ??
		config.port ??
		DEFAULT_API_PORT;
	const resolvedToken = options.accessToken ?? config.accessToken;

	return {
		baseUrl: `http://${host}:${resolvedPort}`,
		port: resolvedPort,
		accessToken: resolvedToken,
	};
}

export interface ApiClientOptions {
	baseUrl: string;
	accessToken?: string;
	timeoutMs?: number;
	fetchImpl?: typeof globalThis.fetch;
}

export class ApiClientError extends Error {
	cause?: unknown;
	status?: number;
	responseBody?: unknown;

	constructor(
		message: string,
		options: {
			status?: number;
			responseBody?: unknown;
			cause?: unknown;
		} = {},
	) {
		super(message);
		this.name = 'ApiClientError';
		this.cause = options.cause;
		this.status = options.status;
		this.responseBody = options.responseBody;
	}
}

function isConnectionError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	if (error.name === 'AbortError' || error.name === 'TimeoutError') {
		return true;
	}

	const message = error.message.toLowerCase();
	return (
		message.includes('fetch failed') ||
		message.includes('econnrefused') ||
		message.includes('timed out') ||
		message.includes('network')
	);
}

function parseJsonResponse(rawBody: string, requestUrl: string): unknown {
	try {
		return JSON.parse(rawBody);
	} catch (error) {
		throw new ApiClientError(
			`Expected JSON response from daemon API at ${requestUrl}.`,
			{cause: error},
		);
	}
}

export class ApiClient {
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof globalThis.fetch;

	constructor(private readonly options: ApiClientOptions) {
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
	}

	async get<T>(path: string): Promise<T> {
		return this.request<T>('GET', path);
	}

	async post<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>('POST', path, body);
	}

	async delete<T>(path: string): Promise<T> {
		return this.request<T>('DELETE', path);
	}

	private async request<T>(
		method: 'GET' | 'POST' | 'DELETE',
		path: string,
		body?: unknown,
	): Promise<T> {
		const normalizedPath = path.startsWith('/') ? path : `/${path}`;
		const requestUrl = `${this.options.baseUrl}${normalizedPath}`;
		const headers = new globalThis.Headers();
		headers.set('accept', 'application/json');
		if (this.options.accessToken) {
			headers.set('x-access-token', this.options.accessToken);
		}
		if (body !== undefined) {
			headers.set('content-type', 'application/json');
		}

		let response: Response;
		try {
			response = await this.fetchImpl(requestUrl, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs),
			});
		} catch (error) {
			if (isConnectionError(error)) {
				throw new ApiClientError(
					`Unable to connect to ArgusDev daemon at ${this.options.baseUrl}. Is the daemon running? Try \`argusdev start\`.`,
					{cause: error},
				);
			}
			throw error;
		}

		const rawBody = await response.text();
		const parsedBody =
			rawBody.length === 0 ? undefined : parseJsonResponse(rawBody, requestUrl);

		if (!response.ok) {
			const defaultMessage = `ArgusDev daemon API request failed: ${method} ${normalizedPath} returned ${response.status}.`;
			const detailMessage =
				typeof parsedBody === 'object' &&
				parsedBody !== null &&
				'message' in parsedBody &&
				typeof parsedBody.message === 'string'
					? `${defaultMessage} ${parsedBody.message}`
					: defaultMessage;
			throw new ApiClientError(detailMessage, {
				status: response.status,
				responseBody: parsedBody,
			});
		}

		return (parsedBody ?? null) as T;
	}
}

export function createApiClient(
	options: Omit<ResolveDaemonApiConfigOptions, 'config'> & {
		config?: ConfigurationData;
		timeoutMs?: number;
		fetchImpl?: typeof globalThis.fetch;
	} = {},
): ApiClient {
	const resolved = resolveDaemonApiConfig(options);
	return new ApiClient({
		baseUrl: resolved.baseUrl,
		accessToken: resolved.accessToken,
		timeoutMs: options.timeoutMs,
		fetchImpl: options.fetchImpl,
	});
}
