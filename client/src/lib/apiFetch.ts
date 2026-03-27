// Authenticated fetch wrapper.
// Sends the access token as x-access-token header (reliable through Vite proxy)
// alongside credentials: 'include' (cookie fallback for production).
// Emits 'argusdev-auth-expired' on 401 so the app can redirect to login.

function getAccessToken(): string | null {
	const match = window.location.pathname.match(
		/^\/([a-z]+-[a-z]+-[a-z]+)(?:\/.*)?$/,
	);
	return match ? match[1] : null;
}

let cachedToken: string | null = null;

export function getToken(): string {
	if (!cachedToken) {
		cachedToken = getAccessToken() || '';
	}
	return cachedToken;
}

export function apiFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const token = getToken();
	const headers = new Headers(init?.headers);
	if (token) {
		headers.set('x-access-token', token);
	}

	return fetch(input, {
		...init,
		credentials: 'include',
		headers,
	}).then(res => {
		if (res.status === 401 && !String(input).includes('/api/auth/')) {
			window.dispatchEvent(new CustomEvent('argusdev-auth-expired'));
		}
		return res;
	});
}
