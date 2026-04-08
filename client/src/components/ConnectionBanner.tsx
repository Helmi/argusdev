import {useAppStore} from '@/lib/store';
import {WifiOff, RefreshCw, KeyRound} from 'lucide-react';

export function ConnectionBanner() {
	const {connectionStatus} = useAppStore();

	if (connectionStatus === 'connected' || connectionStatus === 'connecting')
		return null;

	const isAuthError = connectionStatus === 'auth-error';
	const isReconnecting = connectionStatus === 'disconnected';

	return (
		<div className="shrink-0 border-b border-border bg-amber-500/10 px-4 py-2">
			<div className="flex items-center gap-2">
				{isAuthError ? (
					<KeyRound className="h-3.5 w-3.5 text-amber-400 shrink-0" />
				) : isReconnecting ? (
					<RefreshCw className="h-3.5 w-3.5 text-amber-400 shrink-0 animate-spin" />
				) : (
					<WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
				)}
				<span className="text-xs font-medium text-amber-400">
					{isAuthError
						? 'Session expired — authentication required'
						: isReconnecting
							? 'Connection lost — reconnecting...'
							: 'Unable to reach the server'}
				</span>
				{isAuthError ? (
					<button
						className="text-xs font-medium text-amber-400 underline underline-offset-2 hover:text-amber-300"
						onClick={() => window.location.reload()}
					>
						Reload page
					</button>
				) : (
					<span className="text-xs text-amber-400/60">
						Try{' '}
						<code className="font-mono">argusdev status</code>
						{' '}or{' '}
						<code className="font-mono">argusdev start</code>
						{' '}in your terminal.
					</span>
				)}
			</div>
		</div>
	);
}
