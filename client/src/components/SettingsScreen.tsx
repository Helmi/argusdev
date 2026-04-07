import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  SettingsGeneral,
  SettingsAgents,
  SettingsStatusHooks,
  SettingsWorktreeHooks,
  SettingsTd,
  SettingsProject,
} from '@/components/settings'
import { Settings, Bot, Bell, GitBranch, X, Loader2, ChevronRight, ListTodo, Check } from 'lucide-react'
import { ThemeSelector } from '@/components/ThemeSelector'
import { FontSelector } from '@/components/FontSelector'
import { cn } from '@/lib/utils'
import type { AppConfig, AgentConfig } from '@/lib/types'

type SettingsSection = 'general' | 'agents' | 'status-hooks' | 'worktree-hooks' | 'td' | 'project'

const NAV_ITEMS: { id: SettingsSection; label: string; icon: typeof Settings; description: string }[] = [
  { id: 'general', label: 'General', icon: Settings, description: 'Auto-approval, worktree defaults' },
  { id: 'agents', label: 'Agents', icon: Bot, description: 'Configure agent presets' },
  { id: 'status-hooks', label: 'Status Hooks', icon: Bell, description: 'Session status notifications' },
  { id: 'worktree-hooks', label: 'Worktree Hooks', icon: GitBranch, description: 'Lifecycle automation' },
  { id: 'td', label: 'TD Integration', icon: ListTodo, description: 'Agent TODO lists' },
]

const SECTION_LABELS: Record<SettingsSection, string> = {
  general: 'General',
  agents: 'Agents',
  'status-hooks': 'Status Hooks',
  'worktree-hooks': 'Worktree Hooks',
  td: 'TD Integration',
  project: 'Project Settings',
}

export function SettingsScreen() {
  const {
    settingsSection,
    navigateSettings,
    closeSettings,
    config,
    configLoading,
    updateConfig,
    agents,
    defaultAgentId,
    agentsLoading,
    saveAgent,
    deleteAgent,
    setDefaultAgentId,
    reorderAgents,
    fetchAgents,
  } = useAppStore()

  const [localConfig, setLocalConfig] = useState<AppConfig>(config)
  const [localAgents, setLocalAgents] = useState<AgentConfig[]>(agents)
  const [newAgent, setNewAgent] = useState<AgentConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10)
    return () => clearTimeout(timer)
  }, [])

  // Fetch agents on mount
  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  // Sync local state when store changes
  useEffect(() => {
    setLocalConfig(config)
  }, [config])

  useEffect(() => {
    setLocalAgents(agents)
  }, [agents])

  // Define handleClose before the effect that uses it
  const handleClose = useCallback(() => {
    setIsVisible(false)
    setTimeout(closeSettings, 200) // Wait for animation
  }, [closeSettings])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  const handleSave = async () => {
    setSaving(true)

    // Save general config
    const configSuccess = await updateConfig(localConfig)

    // Save all modified agents
    let agentsSuccess = true
    for (const agent of localAgents) {
      const original = agents.find(a => a.id === agent.id)
      if (JSON.stringify(agent) !== JSON.stringify(original)) {
        const success = await saveAgent(agent)
        if (!success) agentsSuccess = false
      }
    }

    // Save new agent if present
    if (newAgent && newAgent.id && newAgent.name && newAgent.command) {
      const success = await saveAgent(newAgent)
      if (success) setNewAgent(null)
      else agentsSuccess = false
    }

    // Persist agent order if it changed
    const localOrder = localAgents.map(a => a.id)
    const storeOrder = agents.map(a => a.id)
    if (JSON.stringify(localOrder) !== JSON.stringify(storeOrder)) {
      const success = await reorderAgents(localOrder)
      if (!success) agentsSuccess = false
    }

    setSaving(false)
    if (configSuccess && agentsSuccess) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleDeleteAgent = async (agentId: string) => {
    await deleteAgent(agentId)
  }

  const handleSetDefault = async (agentId: string) => {
    await setDefaultAgentId(agentId)
  }

  const startNewAgent = () => {
    setNewAgent({
      id: `agent-${Date.now()}`,
      name: '',
      kind: 'agent',
      command: '',
      enabled: true,
      options: [],
    })
  }

  const renderContent = () => {
    if (configLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )
    }

    switch (settingsSection) {
      case 'general':
        return <SettingsGeneral localConfig={localConfig} setLocalConfig={setLocalConfig} />
      case 'agents':
        return (
          <SettingsAgents
            localAgents={localAgents}
            setLocalAgents={setLocalAgents}
            defaultAgentId={defaultAgentId}
            agentsLoading={agentsLoading}
            onDeleteAgent={handleDeleteAgent}
            onSetDefault={handleSetDefault}
            newAgent={newAgent}
            setNewAgent={setNewAgent}
            startNewAgent={startNewAgent}
          />
        )
      case 'status-hooks':
        return <SettingsStatusHooks localConfig={localConfig} setLocalConfig={setLocalConfig} />
      case 'worktree-hooks':
        return <SettingsWorktreeHooks localConfig={localConfig} setLocalConfig={setLocalConfig} />
      case 'td':
        return <SettingsTd />
      case 'project':
        return <SettingsProject />
      default:
        return null
    }
  }

  // Get current nav item for mobile header
  const currentNavItem = NAV_ITEMS.find(item => item.id === settingsSection)
  const showGlobalSave = settingsSection !== 'td' && settingsSection !== 'project'

  return (
    <>
      {/* Backdrop for visual depth */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]',
          'transition-opacity duration-300',
          isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={handleClose}
      />

      {/* Main panel */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-background flex flex-col',
          'transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          isVisible ? 'translate-x-0 opacity-100' : 'translate-x-[20%] opacity-0'
        )}
      >
        {/* Header */}
        <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-sidebar shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-foreground">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm">Settings</span>
            </div>
            {/* Mobile: show current section */}
            <span className="text-muted-foreground text-sm md:hidden">
              <ChevronRight className="h-3 w-3 inline mx-1" />
              {currentNavItem?.label || SECTION_LABELS[settingsSection]}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeSelector />
            <FontSelector />
            <div className="w-px h-4 bg-border mx-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Mobile navigation - horizontal tabs */}
        <div className="md:hidden border-b border-border bg-sidebar/30 shrink-0 overflow-x-auto">
          <div className="flex px-2 py-1 gap-1 min-w-max">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = settingsSection === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => navigateSettings(item.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded text-xs whitespace-nowrap',
                    'transition-colors duration-150',
                    isActive
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar navigation - hidden on mobile */}
          <nav className="hidden md:flex w-64 border-r border-border bg-sidebar/50 p-3 flex-col gap-1 shrink-0">
            <div className="px-2 py-1.5 mb-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Configuration
              </span>
            </div>
            {NAV_ITEMS.map((item, index) => {
              const Icon = item.icon
              const isActive = settingsSection === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => navigateSettings(item.id)}
                  className={cn(
                    'group relative flex items-center gap-3 pl-2 pr-3 py-2.5 rounded text-left',
                    'transition-all duration-150',
                    isActive
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  )}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  {/* Icon with background pill indicator */}
                  <div className={cn(
                    'flex items-center justify-center w-7 h-7 rounded-md shrink-0',
                    'transition-all duration-150',
                    isActive
                      ? 'bg-primary'
                      : 'bg-transparent group-hover:bg-muted-foreground/20'
                  )}>
                    <Icon className={cn(
                      'h-4 w-4 transition-colors',
                      isActive ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-foreground'
                    )} />
                  </div>
                  <span className={cn('text-sm truncate', isActive && 'font-medium')}>
                    {item.label}
                  </span>
                  {isActive && (
                    <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground shrink-0" />
                  )}
                </button>
              )
            })}
          </nav>

          {/* Content area */}
          <ScrollArea className="flex-1">
            <div className="p-6 max-w-2xl">
              {renderContent()}
            </div>
          </ScrollArea>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-sidebar shrink-0">
          <span className="text-xs text-muted-foreground mr-auto hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Esc</kbd> to close
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-8 px-3 text-sm"
          >
            Cancel
          </Button>
          {showGlobalSave && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || saved || configLoading}
              className={cn('h-8 px-4 text-sm transition-colors', saved && 'bg-green-600 hover:bg-green-600')}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
              {saved && <Check className="h-3.5 w-3.5 mr-2" />}
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
            </Button>
          )}
        </footer>
      </div>
    </>
  )
}
