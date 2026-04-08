import { useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { ThemeSelector } from '@/components/ThemeSelector'
import { FontSelector } from '@/components/FontSelector'
import { FontScaleControl } from '@/components/FontScaleControl'
import { Circle, Wifi, Cpu, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

// Detect Apple platforms (Mac, iPhone, iPad)
function useIsApplePlatform() {
  return useMemo(() => {
    if (typeof navigator === 'undefined') return false
    // Check userAgentData first (modern browsers)
    const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    if (uaData?.platform) {
      return /mac|ios/i.test(uaData.platform)
    }
    // Fallback to userAgent
    return /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
  }, [])
}

export function Footer() {
  const { selectedSessions, connectionStatus } = useAppStore()
  const isApple = useIsApplePlatform()

  const handleLock = () => {
    window.dispatchEvent(new CustomEvent('argusdev-lock'))
  }

  const statusColors: Record<typeof connectionStatus, string> = {
    connected: 'fill-status-active text-status-active',
    connecting: 'fill-status-idle text-status-idle',
    disconnected: 'fill-status-error text-status-error',
    error: 'fill-status-error text-status-error',
    'auth-error': 'fill-status-error text-status-error',
  }

  const statusLabels: Record<typeof connectionStatus, string> = {
    connected: 'Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
    error: 'Error',
    'auth-error': 'Auth expired',
  }

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-sidebar px-3 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
        {/* Connection status */}
        <div className="flex items-center gap-1">
          <Circle className={cn('h-2 w-2', statusColors[connectionStatus])} />
          <span className="hidden sm:inline">{statusLabels[connectionStatus]}</span>
        </div>
        <span className="hidden sm:block text-border">│</span>
        <div className="hidden sm:flex items-center gap-1">
          <Wifi className="h-3 w-3" />
          <span>Local</span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Lock button */}
        <button
          onClick={handleLock}
          className="flex items-center gap-1 text-muted-foreground/70 hover:text-foreground transition-colors"
          title={`Lock screen (${isApple ? '⌘' : 'Ctrl'}+L)`}
        >
          <Lock className="h-3 w-3" />
          <span className="hidden md:inline text-xs">{isApple ? '⌘' : '⌃'}+L</span>
        </button>
        <span className="hidden md:block text-border">│</span>

        {/* Session count */}
        <span>
          {selectedSessions.length} <span className="hidden sm:inline">session{selectedSessions.length !== 1 ? 's' : ''}</span>
        </span>
        <span className="hidden sm:block text-border">│</span>

        {/* Theme/font/scale controls - interactive, hidden on mobile */}
        <div className="hidden md:flex items-center gap-1">
          <ThemeSelector />
        </div>
        <span className="hidden md:block text-border">│</span>

        <div className="hidden lg:flex items-center gap-1">
          <FontSelector />
        </div>
        <span className="hidden lg:block text-border">│</span>

        <div className="hidden lg:flex items-center gap-1">
          <FontScaleControl />
        </div>
        <span className="hidden lg:block text-border">│</span>

        {/* Version */}
        <div className="flex items-center gap-1">
          <Cpu className="h-3 w-3" />
          <span>v{import.meta.env.VITE_APP_VERSION}</span>
        </div>
      </div>
    </footer>
  )
}
