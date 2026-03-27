import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, Terminal, Lock, AlertTriangle } from 'lucide-react'

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

  // Handle keydown for enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit()
    }
  }

  const isLocked = retryAfter > 0
  const canSubmit = passcode.length >= 6 && !isLoading && !isLocked

  // Format countdown display
  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, '0')}`
    }
    return `${secs}s`
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0a0f0a] relative overflow-hidden">
      {/* CRT scanlines overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)',
        }}
      />

      {/* Subtle vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 0%, transparent 50%, rgba(0,0,0,0.4) 100%)',
        }}
      />

      {/* Ambient glow */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0,255,65,0.06) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Main container */}
      <div className="relative z-20 w-full max-w-md mx-4">
        {/* Terminal window */}
        <div className="bg-[#0d120d] border border-[#1a3a1a] rounded-sm shadow-2xl overflow-hidden">
          {/* Terminal header */}
          <div className="flex items-center gap-2 px-4 py-2 bg-[#0a0f0a] border-b border-[#1a3a1a]">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
            </div>
            <span className="flex-1 text-center text-[10px] text-[#3a6a3a] uppercase tracking-[0.2em] font-mono">
              argusdev://auth
            </span>
          </div>

          {/* Terminal body */}
          <div className="p-6 space-y-6">
            {/* ASCII art header */}
            <pre className="text-[#00ff41] text-[10px] leading-tight font-mono text-center select-none opacity-80">
{` █████╗ ██████╗  ██████╗ ██╗   ██╗███████╗
██╔══██╗██╔══██╗██╔════╝ ██║   ██║██╔════╝
███████║██████╔╝██║  ███╗██║   ██║███████╗
██╔══██║██╔══██╗██║   ██║██║   ██║╚════██║
██║  ██║██║  ██║╚██████╔╝╚██████╔╝███████║
╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚══════╝`}
            </pre>

            {/* System message */}
            <div className="space-y-1 font-mono text-xs">
              <div className="text-[#3a6a3a]">
                <span className="text-[#00ff41]">[SYSTEM]</span> Authentication required
              </div>
              <div className="text-[#3a6a3a]">
                <span className="text-[#00ff41]">[STATUS]</span>{' '}
                {isLocked ? (
                  <span className="text-[#ff6b6b]">LOCKED - Too many attempts</span>
                ) : (
                  <span className="text-[#00ff41]">READY</span>
                )}
              </div>
            </div>

            {/* Input area */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[#00ff41] text-xs font-mono">
                  <Lock className="w-3 h-3" />
                  ENTER PASSCODE:
                </label>

                <div className="relative">
                  {/* Input container with glow */}
                  <div
                    className={`
                      relative bg-[#0a0f0a] border rounded-sm px-3 py-2
                      transition-all duration-200
                      ${isLocked
                        ? 'border-[#ff6b6b]/50'
                        : error
                          ? 'border-[#ff6b6b]/50'
                          : 'border-[#1a3a1a] focus-within:border-[#00ff41]/50 focus-within:shadow-[0_0_10px_rgba(0,255,65,0.15)]'
                      }
                    `}
                  >
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-[#00ff41] text-sm">&gt;</span>
                      <input
                        ref={inputRef}
                        type="password"
                        value={passcode}
                        onChange={(e) => {
                          // Alphanumeric only
                          const cleaned = e.target.value.replace(/[^a-zA-Z0-9]/g, '')
                          setPasscode(cleaned)
                          setError(null)
                        }}
                        onKeyDown={handleKeyDown}
                        disabled={isLoading || isLocked}
                        placeholder={isLocked ? 'LOCKED' : '******'}
                        className={`
                          flex-1 bg-transparent border-none outline-none
                          text-[#00ff41] text-sm tracking-[0.3em] font-mono
                          placeholder:text-[#2a4a2a] placeholder:tracking-[0.3em]
                          disabled:opacity-50 disabled:cursor-not-allowed
                        `}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {isLoading && (
                        <Loader2 className="w-4 h-4 text-[#00ff41] animate-spin" />
                      )}
                    </div>
                  </div>

                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="flex items-center gap-2 text-[#ff6b6b] text-xs font-mono bg-[#ff6b6b]/10 px-3 py-2 rounded-sm border border-[#ff6b6b]/20">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Rate limit countdown */}
              {isLocked && (
                <div className="flex items-center justify-center gap-3 text-[#ff6b6b] text-sm font-mono py-2">
                  <div className="flex items-center gap-2">
                    <span className="animate-pulse">⏳</span>
                    <span>Retry in</span>
                    <span className="text-lg font-bold tabular-nums">
                      {formatCountdown(retryAfter)}
                    </span>
                  </div>
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={!canSubmit}
                className={`
                  w-full py-2 px-4 font-mono text-sm uppercase tracking-wider
                  border rounded-sm transition-all duration-200
                  ${canSubmit
                    ? 'bg-[#00ff41]/10 border-[#00ff41]/50 text-[#00ff41] hover:bg-[#00ff41]/20 hover:shadow-[0_0_15px_rgba(0,255,65,0.2)]'
                    : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#3a3a3a] cursor-not-allowed'
                  }
                `}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    AUTHENTICATING...
                  </span>
                ) : (
                  'AUTHENTICATE'
                )}
              </button>
            </form>

            {/* Help text */}
            <div className="pt-2 border-t border-[#1a3a1a]">
              <div className="flex items-start gap-2 text-[10px] text-[#3a6a3a] font-mono">
                <Terminal className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p>Forgot your passcode?</p>
                  <p className="text-[#00ff41]/70">
                    Run: <code className="bg-[#0a0f0a] px-1 py-0.5 rounded text-[#00ff41]">argusdev auth reset-passcode</code>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center text-[10px] text-[#2a4a2a] font-mono">
          ArgusDev v{import.meta.env.VITE_APP_VERSION || '0.0.0'}
        </div>
      </div>
    </div>
  )
}
