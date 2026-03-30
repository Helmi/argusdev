import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, Lock, AlertTriangle, Terminal } from 'lucide-react'

interface PasscodeEntryProps {
  onSuccess: () => void
  error?: string
  retryAfter?: number // seconds until retry allowed
}

export function PasscodeEntry({ onSuccess, error: externalError, retryAfter: externalRetryAfter }: PasscodeEntryProps) {
  const [passcode, setPasscode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(externalError || null)
  const [retryAfter, setRetryAfter] = useState<number>(externalRetryAfter || 0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync external props
  useEffect(() => {
    if (externalError) setError(externalError)
  }, [externalError])

  useEffect(() => {
    if (externalRetryAfter) setRetryAfter(externalRetryAfter)
  }, [externalRetryAfter])

  // Countdown timer for rate limiting
  useEffect(() => {
    if (retryAfter <= 0) return
    const timer = setInterval(() => {
      setRetryAfter(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [retryAfter])

  // Permanent focus - refocus on any blur
  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    input.focus()

    const handleBlur = () => {
      // Small delay to allow click events to process first
      setTimeout(() => {
        if (!isLoading) {
          inputRef.current?.focus()
        }
      }, 10)
    }

    input.addEventListener('blur', handleBlur)
    return () => input.removeEventListener('blur', handleBlur)
  }, [isLoading])

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (passcode.length < 6 || isLoading || retryAfter > 0) return

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ passcode }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        onSuccess()
      } else {
        setError(data.error || 'Invalid passcode')
        if (data.retryAfter) {
          setRetryAfter(data.retryAfter)
        }
        setPasscode('')
      }
    } catch {
      setError('Connection failed. Try again.')
      setPasscode('')
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }, [passcode, isLoading, retryAfter, onSuccess])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit()
    }
  }

  const isLocked = retryAfter > 0
  const canSubmit = passcode.length >= 6 && !isLoading && !isLocked

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins > 0) return `${mins}:${secs.toString().padStart(2, '0')}`
    return `${secs}s`
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4 space-y-6">
        {/* Icon + heading */}
        <div className="flex flex-col items-center gap-3 text-center">
          <Lock className="h-10 w-10 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">ArgusDev</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLocked ? 'Too many attempts. Please wait.' : 'Enter your passcode to continue.'}
            </p>
          </div>
        </div>

        {/* Passcode form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div
              className={`
                flex items-center gap-2 rounded-md border bg-sidebar px-3 py-2
                transition-colors
                ${isLocked
                  ? 'border-destructive/50'
                  : error
                    ? 'border-destructive/50'
                    : 'border-border focus-within:border-ring'}
              `}
            >
              <Lock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                type="password"
                value={passcode}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^a-zA-Z0-9]/g, '')
                  setPasscode(cleaned)
                  setError(null)
                }}
                onKeyDown={handleKeyDown}
                disabled={isLoading || isLocked}
                placeholder={isLocked ? 'Locked' : 'Passcode'}
                className="flex-1 bg-transparent border-none outline-none text-sm text-foreground tracking-widest placeholder:text-muted-foreground/50 placeholder:tracking-normal disabled:opacity-50 disabled:cursor-not-allowed font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              {isLoading && (
                <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
              )}
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-xs rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Rate limit countdown */}
          {isLocked && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-1">
              <span>Retry in</span>
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {formatCountdown(retryAfter)}
              </span>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={!canSubmit}
            className={`
              w-full py-2 px-4 text-sm font-medium rounded-md transition-colors
              ${canSubmit
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed'}
            `}
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Authenticating...
              </span>
            ) : (
              'Authenticate'
            )}
          </button>
        </form>

        {/* Help text */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Terminal className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <div>
            <span>Forgot your passcode? Run </span>
            <code className="rounded bg-sidebar px-1 py-0.5 font-mono text-foreground">argusdev auth reset-passcode</code>
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
