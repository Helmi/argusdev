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
import { AuthErrorScreen } from '@/components/AuthErrorScreen'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Loader2, Terminal } from 'lucide-react'

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
    window.addEventListener('argusdev-lock', handleLockEvent)
    return () => window.removeEventListener('argusdev-lock', handleLockEvent)
  }, [authState, lockScreen])

  // Circuit breaker: redirect to passcode on 401 from any API call
  useEffect(() => {
    if (authState !== 'authenticated') return

    const handleAuthExpired = () => setAuthState('needs-passcode')
    window.addEventListener('argusdev-auth-expired', handleAuthExpired)
    return () => window.removeEventListener('argusdev-auth-expired', handleAuthExpired)
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
      return <AuthErrorScreen type="no-token" />
    case 'invalid-token':
      return <AuthErrorScreen type="invalid-token" />
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
