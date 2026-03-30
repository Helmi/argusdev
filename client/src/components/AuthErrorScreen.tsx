import { ShieldAlert, ShieldX, Terminal } from 'lucide-react'

interface AuthErrorScreenProps {
  type: 'no-token' | 'invalid-token'
}

export function AuthErrorScreen({ type }: AuthErrorScreenProps) {
  const isInvalid = type === 'invalid-token'

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4 space-y-6">
        {/* Icon + heading */}
        <div className="flex flex-col items-center gap-3 text-center">
          {isInvalid ? (
            <ShieldX className="h-10 w-10 text-destructive" />
          ) : (
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
          )}
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {isInvalid ? 'Access Denied' : 'Token Required'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isInvalid
                ? 'This access token is not recognized.'
                : 'This interface requires a valid access token in the URL.'}
            </p>
          </div>
        </div>

        {/* Command hint */}
        <div className="rounded-md border border-border bg-sidebar p-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            {isInvalid ? 'Get the correct URL from your terminal:' : 'Get your access URL from the terminal:'}
          </p>
          <div className="flex items-center gap-2 rounded-sm bg-background px-3 py-2 font-mono text-sm text-foreground">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <code>argusdev auth show</code>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          ArgusDev v{import.meta.env.VITE_APP_VERSION || '0.0.0'}
        </p>
      </div>
    </div>
  )
}
