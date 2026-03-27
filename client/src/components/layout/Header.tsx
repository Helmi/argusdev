import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { ThemeSelector } from '@/components/ThemeSelector'
import { FontSelector } from '@/components/FontSelector'
import { FontScaleControl } from '@/components/FontScaleControl'
import { PanelLeft, Settings, Zap } from 'lucide-react'

export function Header() {
  const { toggleSidebar, isDevMode, openSettings, updateInfo } = useAppStore()
  const hasUpdate = updateInfo?.isUpdateAvailable === true

  return (
    <header className="flex h-9 items-center justify-between border-b border-border bg-sidebar px-3 text-sm">
      <div className="flex items-center gap-2">
        {/* Sidebar toggle for mobile */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 md:hidden"
          onClick={toggleSidebar}
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </Button>

        {/* Logo */}
        <span className="text-lg font-bold tracking-tight text-foreground flex items-center">
          Argus<Zap className="h-4 w-4 mx-0.5 text-yellow-500 fill-yellow-500" />Dev
        </span>

        {/* DEV indicator */}
        {isDevMode && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            DEV
          </span>
        )}

        {hasUpdate && (
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
            Update available: v{updateInfo?.latestVersion || 'new'} → argusdev update
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => openSettings()}
          title="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>

        {/* Theme/font controls - hidden on mobile, accessible via Settings */}
        <div className="hidden md:flex items-center gap-1">
          <ThemeSelector />
          <FontSelector />
          <FontScaleControl />
        </div>
      </div>
    </header>
  )
}
