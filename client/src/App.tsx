import { useState, useEffect, useCallback } from 'react'
import { AppProvider, useAppStore } from '@/lib/store'
import { Layout } from '@/components/layout'
import { SessionGrid } from '@/components/SessionGrid'
import { InlineDiffViewer } from '@/components/InlineDiffViewer'
import { FileViewer } from '@/components/FileViewer'
import { TaskBoard } from '@/components/TaskBoard'
import { ConversationView } from '@/components/ConversationView'
import { ErrorBanner } from '@/components/ErrorBanner'
import { AddProjectScreen } from '@/components/AddProjectScreen'
import { AddWorktreeScreen } from '@/components/AddWorktreeScreen'
import { AddSessionScreen } from '@/components/AddSessionScreen'
import { SettingsScreen } from '@/components/SettingsScreen'
import { PasscodeEntry } from '@/components/PasscodeEntry'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Terminal, Loader2 } from 'lucide-react'

type AuthState = 'loading' | 'no-token' | 'invalid-token' | 'needs-passcode' | 'authenticated'

// Extract access token from URL path (e.g., /apple-desk-river)
function getAccessToken(): string | null {
  const path = window.location.pathname
  // Token should be the first path segment after /
  const match = path.match(/^\/([a-z]+-[a-z]+-[a-z]+)(?:\/.*)?$/)
  return match ? match[1] : null
}

function MainContent() {
  const { selectedSessions, viewingFileDiff, viewingFile, taskBoardOpen, conversationViewOpen } = useAppStore()

  // Show task board when toggled
  if (taskBoardOpen) {
    return <TaskBoard />
  }

  // Show conversation view when toggled
  if (conversationViewOpen) {
    return <ConversationView />
  }

  // Show diff viewer when viewing a file diff
  if (viewingFileDiff) {
    return <InlineDiffViewer />
  }

  // Show file viewer when viewing a file from file browser
  if (viewingFile) {
    return <FileViewer />
  }

  if (selectedSessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Terminal className="h-12 w-12 opacity-50" />
        <div className="text-center text-sm">
          <p>No sessions selected</p>
          <p className="text-xs">Click a session in the sidebar to view it</p>
        </div>
      </div>
    )
  }

  return <SessionGrid />
}

function AuthenticatedAppContent() {
  const { settingsOpen, addProjectOpen, addWorktreeOpen, addSessionOpen } = useAppStore()

  return (
    <>
      <ErrorBanner />
      <Layout>
        <MainContent />
      </Layout>
      {/* Full-screen overlays */}
      {addProjectOpen && <AddProjectScreen />}
      {addWorktreeOpen && <AddWorktreeScreen />}
      {addSessionOpen && <AddSessionScreen />}
      {settingsOpen && <SettingsScreen />}
    </>
  )
}

// Wrap with AppProvider so store only initializes after auth
function AuthenticatedApp() {
  return (
    <AppProvider>
      <AuthenticatedAppContent />
    </AppProvider>
  )
}

// No token in URL - show terminal access message
function NoTokenView() {
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
              cacd://restricted
            </span>
          </div>

          {/* Terminal body */}
          <div className="p-6 space-y-6">
            {/* ASCII art header */}
            <pre className="text-[#00ff41] text-[10px] leading-tight font-mono text-center select-none opacity-80">
{`   ██████╗ █████╗  ██████╗██████╗
  ██╔════╝██╔══██╗██╔════╝██╔══██╗
  ██║     ███████║██║     ██║  ██║
  ██║     ██╔══██║██║     ██║  ██║
  ╚██████╗██║  ██║╚██████╗██████╔╝
   ╚═════╝╚═╝  ╚═╝ ╚═════╝╚═════╝`}
            </pre>

            {/* System message */}
            <div className="space-y-1 font-mono text-xs">
              <div className="text-[#3a6a3a]">
                <span className="text-[#00ff41]">[SYSTEM]</span> Access restricted
              </div>
              <div className="text-[#3a6a3a]">
                <span className="text-[#00ff41]">[STATUS]</span>{' '}
                <span className="text-[#febc2e]">TOKEN REQUIRED</span>
              </div>
            </div>

            {/* Message */}
            <div className="space-y-4">
              <p className="text-[#3a6a3a] text-xs font-mono">
                This interface requires a valid access token in the URL.
              </p>

              <div className="bg-[#0a0f0a] border border-[#1a3a1a] rounded-sm p-3">
                <p className="text-[10px] text-[#3a6a3a] font-mono mb-2">
                  Get your access URL from the terminal:
                </p>
                <code className="block bg-[#0d120d] px-3 py-2 rounded-sm text-sm font-mono text-[#00ff41]">
                  cacd auth show
                </code>
              </div>

            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center text-[10px] text-[#2a4a2a] font-mono">
          Coding Agent Control Desk v{import.meta.env.VITE_APP_VERSION || '0.0.0'}
        </div>
      </div>
    </div>
  )
}

// Invalid token - show error message
function InvalidTokenView() {
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

      {/* Ambient glow - red tint for error */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(255,107,107,0.06) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Main container */}
      <div className="relative z-20 w-full max-w-md mx-4">
        {/* Terminal window */}
        <div className="bg-[#0d120d] border border-[#3a1a1a] rounded-sm shadow-2xl overflow-hidden">
          {/* Terminal header */}
          <div className="flex items-center gap-2 px-4 py-2 bg-[#0a0f0a] border-b border-[#3a1a1a]">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
            </div>
            <span className="flex-1 text-center text-[10px] text-[#6a3a3a] uppercase tracking-[0.2em] font-mono">
              cacd://error
            </span>
          </div>

          {/* Terminal body */}
          <div className="p-6 space-y-6">
            {/* ASCII art header */}
            <pre className="text-[#ff6b6b] text-[10px] leading-tight font-mono text-center select-none opacity-80">
{`   ██████╗ █████╗  ██████╗██████╗
  ██╔════╝██╔══██╗██╔════╝██╔══██╗
  ██║     ███████║██║     ██║  ██║
  ██║     ██╔══██║██║     ██║  ██║
  ╚██████╗██║  ██║╚██████╗██████╔╝
   ╚═════╝╚═╝  ╚═╝ ╚═════╝╚═════╝`}
            </pre>

            {/* System message */}
            <div className="space-y-1 font-mono text-xs">
              <div className="text-[#6a3a3a]">
                <span className="text-[#ff6b6b]">[ERROR]</span> Invalid access token
              </div>
              <div className="text-[#6a3a3a]">
                <span className="text-[#ff6b6b]">[STATUS]</span>{' '}
                <span className="text-[#ff6b6b]">ACCESS DENIED</span>
              </div>
            </div>

            {/* Message */}
            <div className="space-y-4">
              <p className="text-[#6a3a3a] text-xs font-mono">
                This access token is not recognized.
              </p>

              <div className="bg-[#0a0f0a] border border-[#3a1a1a] rounded-sm p-3">
                <p className="text-[10px] text-[#6a3a3a] font-mono mb-2">
                  Get the correct URL from your terminal:
                </p>
                <code className="block bg-[#0d120d] px-3 py-2 rounded-sm text-sm font-mono text-[#ff6b6b]">
                  cacd auth show
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center text-[10px] text-[#4a2a2a] font-mono">
          Coding Agent Control Desk v{import.meta.env.VITE_APP_VERSION || '0.0.0'}
        </div>
      </div>
    </div>
  )
}

// Loading state
function LoadingView() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground font-mono">Connecting...</p>
      </div>
    </div>
  )
}

function AppContent() {
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [passcodeError, setPasscodeError] = useState<string | undefined>()
  const [retryAfter, setRetryAfter] = useState<number | undefined>()

  // Lock screen - logout and return to passcode entry
  const lockScreen = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Ignore errors - we're locking anyway
    }
    setAuthState('needs-passcode')
  }, [])

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus()
  }, [])

  // Keyboard shortcut: Cmd+L / Ctrl+L (or with Shift)
  useEffect(() => {
    if (authState !== 'authenticated') return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Accept Cmd+L, Ctrl+L, Cmd+Shift+L, Ctrl+Shift+L
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyL' && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        lockScreen()
      }
    }

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [authState, lockScreen])

  // Listen for lock event from Footer button
  useEffect(() => {
    if (authState !== 'authenticated') return

    const handleLockEvent = () => lockScreen()
    window.addEventListener('cacd-lock', handleLockEvent)
    return () => window.removeEventListener('cacd-lock', handleLockEvent)
  }, [authState, lockScreen])

  // Circuit breaker: redirect to passcode on 401 from any API call
  useEffect(() => {
    if (authState !== 'authenticated') return

    const handleAuthExpired = () => setAuthState('needs-passcode')
    window.addEventListener('cacd-auth-expired', handleAuthExpired)
    return () => window.removeEventListener('cacd-auth-expired', handleAuthExpired)
  }, [authState])

  const checkAuthStatus = async () => {
    const token = getAccessToken()

    // No token in URL
    if (!token) {
      setAuthState('no-token')
      return
    }

    try {
      // First validate the token
      const tokenRes = await fetch(`/api/auth/validate-token?token=${encodeURIComponent(token)}`)
      const tokenData = await tokenRes.json()

      if (!tokenRes.ok || !tokenData.valid) {
        setAuthState('invalid-token')
        return
      }

      // Then check session status
      const sessionRes = await fetch('/api/auth/status', {
        credentials: 'include',
      })
      const sessionData = await sessionRes.json()

      if (sessionRes.ok && sessionData.authenticated) {
        setAuthState('authenticated')
      } else {
        setAuthState('needs-passcode')
      }
    } catch {
      // On network error, assume needs auth
      setAuthState('needs-passcode')
    }
  }

  const handlePasscodeSuccess = useCallback(() => {
    setAuthState('authenticated')
    setPasscodeError(undefined)
    setRetryAfter(undefined)
  }, [])

  // Render based on auth state
  switch (authState) {
    case 'loading':
      return <LoadingView />
    case 'no-token':
      return <NoTokenView />
    case 'invalid-token':
      return <InvalidTokenView />
    case 'needs-passcode':
      return (
        <PasscodeEntry
          onSuccess={handlePasscodeSuccess}
          error={passcodeError}
          retryAfter={retryAfter}
        />
      )
    case 'authenticated':
      return <AuthenticatedApp />
  }
}

function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <AppContent />
    </TooltipProvider>
  )
}

export default App
