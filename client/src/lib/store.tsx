import { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import type { Session, Worktree, Project, ThemeType, FontType, ConnectionStatus, AppConfig, ChangedFile, AgentConfig, AgentsConfig, TdStatus, TdIssue, ProjectConfig, TdPromptTemplate } from './types'
import { mapBackendToFrontend, mapFrontendToBackend, getDefaultConfig } from './configMapper'
import { resolveTdIssueWorktreePath } from './tdWorktreeResolver'

// Debounce utility
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn(...args), delay)
  }) as T & { cancel: () => void }
  debounced.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId)
  }
  return debounced
}

// Initialize socket - don't auto-connect, we'll connect after auth
const socket: Socket = io({
  withCredentials: true, // Send cookies with socket requests
  autoConnect: false, // Don't connect until AppProvider mounts (after auth)
})

type AddSessionIntent = 'work' | 'review' | 'fix' | 'fix'

interface AddSessionContext {
  intent?: AddSessionIntent
  sessionName?: string
  createdBranch?: string
  promptTemplate?: string
}

interface AppState {
  // Data
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
  currentProject: Project | null

  // Agents
  agents: AgentConfig[]
  defaultAgentId: string | null
  agentsLoading: boolean

  // UI State
  selectedSessions: string[]
  focusedSessionId: string | null
  sidebarOpen: boolean
  sidebarCollapsed: boolean
  contextSidebarSessionId: string | null
  sessionContextTabs: Record<string, 'changes' | 'files'>

  // Inline View State
  addProjectOpen: boolean
  addWorktreeOpen: boolean
  addWorktreeProjectPath: string | null  // Pre-selected project context for worktree
  addSessionOpen: boolean
  addSessionWorktreePath: string | null  // Pre-selected worktree context
  addSessionProjectPath: string | null  // Pre-selected project context
  addSessionTdTaskId: string | null  // Pre-selected td task
  addSessionIntent: AddSessionIntent | null
  addSessionSessionName: string | null

  // Settings Screen State
  settingsOpen: boolean
  settingsSection: 'general' | 'agents' | 'status-hooks' | 'worktree-hooks' | 'td' | 'project'

  // File Diff Viewing State
  viewingFileDiff: { sessionId: string; file: ChangedFile; worktreePath: string } | null

  // File Viewing State (from file browser)
  viewingFile: { worktreePath: string; filePath: string } | null

  // Config
  config: AppConfig
  configLoading: boolean

  // Theme
  theme: ThemeType
  font: FontType
  fontScale: number

  // Connection
  connectionStatus: ConnectionStatus

  // Server info
  isDevMode: boolean

  // Error handling
  error: string | null

  // TD Integration
  tdStatus: TdStatus | null
  tdStatusLoading: boolean
  tdIssues: TdIssue[]
  tdBoardView: Record<string, TdIssue[]>
  taskBoardOpen: boolean
  conversationViewOpen: boolean
  conversationInitialSessionId: string | null
  conversationTaskFilterId: string | null
  tdReviewNotifications: Array<{id: string; title: string; priority: string}>
  projectConfig: ProjectConfig | null
  projectConfigPath: string | null

  // Socket
  socket: Socket
}

interface AppActions {
  // Data fetching
  fetchData: () => void
  fetchAgents: () => Promise<void>
  selectProject: (path: string) => Promise<boolean>

  // Agent management
  saveAgent: (agent: AgentConfig) => Promise<boolean>
  deleteAgent: (agentId: string) => Promise<boolean>
  setDefaultAgentId: (agentId: string) => Promise<boolean>

  // Session selection
  selectSession: (sessionId: string) => void
  deselectSession: (sessionId: string) => void
  toggleSession: (sessionId: string) => void
  clearSessions: () => void
  focusSession: (sessionId: string) => void

  // Sidebar
  toggleSidebar: () => void
  collapseSidebar: () => void
  expandSidebar: () => void

  // Context sidebar
  openContextSidebar: (sessionId: string) => void
  closeContextSidebar: () => void
  toggleContextSidebar: (sessionId: string) => void
  setSessionContextTab: (sessionId: string, tab: 'changes' | 'files') => void

  // Theme
  setTheme: (theme: ThemeType) => void
  setFont: (font: FontType) => void
  setFontScale: (scale: number) => void

  // Session management
  createSession: (path: string, presetId?: string, sessionName?: string) => Promise<boolean>
  createSessionWithAgent: (
    path: string,
    agentId: string,
    options?: Record<string, boolean | string>,
    sessionName?: string,
    taskListName?: string,
    tdTaskId?: string,
    promptTemplate?: string,
    intent?: 'work' | 'review' | 'manual'
  ) => Promise<boolean>
  renameSession: (sessionId: string, name: string) => Promise<boolean>
  stopSession: (sessionId: string) => Promise<void>
  restartSession: (sessionId: string) => Promise<void>

  // Project management
  addProject: (path: string, name?: string) => Promise<boolean>
  updateProject: (path: string, name: string) => Promise<boolean>
  removeProject: (path: string) => Promise<boolean>

  // Worktree management
  createWorktree: (path: string, branch: string, baseBranch: string, copySessionData: boolean, copyClaudeDirectory: boolean, projectPath?: string) => Promise<boolean>
  deleteWorktree: (path: string, deleteBranch: boolean, projectPath?: string) => Promise<boolean>

  // Inline View actions
  openAddProject: () => void
  closeAddProject: () => void
  openAddWorktree: (projectPath?: string) => void
  closeAddWorktree: () => void
  openAddSession: (worktreePath?: string, projectPath?: string, tdTaskId?: string, context?: AddSessionContext) => void
  closeAddSession: () => void
  openSettings: (section?: 'general' | 'agents' | 'status-hooks' | 'worktree-hooks' | 'td' | 'project') => void
  closeSettings: () => void
  navigateSettings: (section: 'general' | 'agents' | 'status-hooks' | 'worktree-hooks' | 'td' | 'project') => void

  // Config
  updateConfig: (config: AppConfig) => Promise<boolean>
  configLoading: boolean

  // File diff viewing
  openFileDiff: (sessionId: string, file: ChangedFile, worktreePath: string) => void
  closeFileDiff: () => void

  // File viewing (from file browser)
  openFile: (worktreePath: string, filePath: string) => void
  closeFile: () => void

  // TD Integration
  fetchTdStatus: () => Promise<void>
  fetchProjectConfig: () => Promise<void>
  saveProjectConfig: (config: ProjectConfig) => Promise<boolean>
  initializeTdProject: () => Promise<boolean>
  fetchTdPrompts: (scope?: 'project' | 'global' | 'effective' | 'all') => Promise<TdPromptTemplate[]>
  saveTdPrompt: (name: string, content: string, scope?: 'project' | 'global') => Promise<boolean>
  deleteTdPrompt: (name: string, scope?: 'project' | 'global') => Promise<boolean>
  fetchTdIssues: (options?: { status?: string; type?: string; parentId?: string }) => Promise<void>
  fetchTdBoard: () => Promise<void>
  openTaskBoard: () => void
  closeTaskBoard: () => void
  openConversationView: (context?: { sessionId?: string; taskId?: string }) => void
  closeConversationView: () => void
  dismissTdReviewNotification: (issueId: string) => void
  dismissAllTdReviewNotifications: () => void

  // Error handling
  clearError: () => void
}

type AppStore = AppState & AppActions

const AppContext = createContext<AppStore | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  // Data state
  const [projects, setProjects] = useState<Project[]>([])
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)

  // Agents state
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null)
  const [agentsLoading, setAgentsLoading] = useState(true)

  // UI state
  const [selectedSessions, setSelectedSessions] = useState<string[]>([])
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null)
  // Sidebar closed by default on mobile (< 768px)
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.innerWidth >= 768
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [contextSidebarSessionId, setContextSidebarSessionId] = useState<string | null>(null)

  // Track which sessions have sidebar open (per-session preference)
  const [sessionsWithSidebarOpen, setSessionsWithSidebarOpenState] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('cacd_sessionsWithSidebarOpen')
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch {
      return new Set()
    }
  })

  // Wrapper to persist sessionsWithSidebarOpen to localStorage
  const setSessionsWithSidebarOpen = useCallback((value: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setSessionsWithSidebarOpenState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value
      localStorage.setItem('cacd_sessionsWithSidebarOpen', JSON.stringify([...newValue]))
      return newValue
    })
  }, [])

  // Track which tab (changes/files) each session has selected
  const [sessionContextTabs, setSessionContextTabsState] = useState<Record<string, 'changes' | 'files'>>(() => {
    try {
      const saved = localStorage.getItem('cacd_sessionContextTabs')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })

  const setSessionContextTab = useCallback((sessionId: string, tab: 'changes' | 'files') => {
    setSessionContextTabsState(prev => {
      const next = { ...prev, [sessionId]: tab }
      localStorage.setItem('cacd_sessionContextTabs', JSON.stringify(next))
      return next
    })
  }, [])

  // Inline View state
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [addWorktreeOpen, setAddWorktreeOpen] = useState(false)
  const [addWorktreeProjectPath, setAddWorktreeProjectPath] = useState<string | null>(null)
  const [addSessionOpen, setAddSessionOpen] = useState(false)
  const [addSessionWorktreePath, setAddSessionWorktreePath] = useState<string | null>(null)
  const [addSessionProjectPath, setAddSessionProjectPath] = useState<string | null>(null)
  const [addSessionTdTaskId, setAddSessionTdTaskId] = useState<string | null>(null)
  const [addSessionIntent, setAddSessionIntent] = useState<AddSessionIntent | null>(null)
  const [addSessionSessionName, setAddSessionSessionName] = useState<string | null>(null)
  const [viewingFileDiff, setViewingFileDiff] = useState<{ sessionId: string; file: ChangedFile; worktreePath: string } | null>(null)
  const [viewingFile, setViewingFile] = useState<{ worktreePath: string; filePath: string } | null>(null)

  // Settings screen state - load section from localStorage
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<'general' | 'agents' | 'status-hooks' | 'worktree-hooks' | 'td' | 'project'>(() => {
    const saved = localStorage.getItem('cacd_settings_section')
    if (saved === 'general' || saved === 'agents' || saved === 'status-hooks' || saved === 'worktree-hooks' || saved === 'td' || saved === 'project') {
      return saved
    }
    return 'general'
  })

  // Config state - loaded from backend API
  const [config, setConfig] = useState<AppConfig>(getDefaultConfig())
  const [configLoading, setConfigLoading] = useState(true)

  // Theme state - load from localStorage
  const [theme, setThemeState] = useState<ThemeType>(() => {
    return (localStorage.getItem('cacd_theme') as ThemeType) || 'default'
  })
  const [font, setFontState] = useState<FontType>(() => {
    return (localStorage.getItem('cacd_font') as FontType) || 'jetbrains'
  })
  const [fontScale, setFontScaleState] = useState(() => {
    return parseInt(localStorage.getItem('cacd_fontScale') || '100', 10)
  })

  // Connection state
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')

  // Server info
  const [isDevMode, setIsDevMode] = useState(false)

  // Error state
  const [error, setError] = useState<string | null>(null)

  // TD Integration state
  const [tdStatus, setTdStatus] = useState<TdStatus | null>(null)
  const [tdStatusLoading, setTdStatusLoading] = useState(true)
  const [tdIssues, setTdIssues] = useState<TdIssue[]>([])
  const [tdBoardView, setTdBoardView] = useState<Record<string, TdIssue[]>>({})
  const [taskBoardOpen, setTaskBoardOpen] = useState(false)
  const [taskBoardReturnSessionId, setTaskBoardReturnSessionId] = useState<string | null>(null)
  const [conversationViewOpen, setConversationViewOpen] = useState(false)
  const [conversationInitialSessionId, setConversationInitialSessionId] = useState<string | null>(null)
  const [conversationTaskFilterId, setConversationTaskFilterId] = useState<string | null>(null)
  const [tdReviewNotifications, setTdReviewNotifications] = useState<Array<{id: string; title: string; priority: string}>>([])
  const [projectConfig, setProjectConfig] = useState<ProjectConfig | null>(null)
  const [projectConfigPath, setProjectConfigPath] = useState<string | null>(null)

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement
    root.className = root.className.replace(/theme-\w+/g, '')
    if (theme !== 'default') {
      root.classList.add(`theme-${theme}`)
    }
    localStorage.setItem('cacd_theme', theme)
  }, [theme])

  // Apply font to body
  useEffect(() => {
    const body = document.body
    body.className = body.className.replace(/font-\w+/g, '')
    body.classList.add(`font-${font}`)
    localStorage.setItem('cacd_font', font)
  }, [font])

  // Apply font scale
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale}%`
    localStorage.setItem('cacd_fontScale', String(fontScale))
  }, [fontScale])

  // Fetch session-related data only (frequent updates)
  const fetchSessionData = useCallback(async () => {
    try {
      const [stateRes, sessionsRes] = await Promise.all([
        fetch('/api/state', { credentials: 'include' }),
        fetch('/api/sessions', { credentials: 'include' }),
      ])

      if (!stateRes.ok || !sessionsRes.ok) {
        console.error('Failed to fetch session data')
        return
      }

      const [state, sessionsData] = await Promise.all([
        stateRes.json(),
        sessionsRes.json(),
      ])

      setCurrentProject(state.selectedProject || null)
      if (state.isDevMode !== undefined) setIsDevMode(state.isDevMode)
      setSessions(sessionsData)
    } catch (err) {
      console.error('Failed to fetch session data:', err)
    }
  }, [])

  // Debounced version of fetchSessionData for socket events (250ms delay)
  const debouncedFetchSessionData = useMemo(
    () => debounce(fetchSessionData, 250),
    [fetchSessionData]
  )

  const normalizeTdStatus = useCallback((data: unknown): TdStatus | null => {
    if (!data || typeof data !== 'object') return null

    const raw = data as Record<string, unknown>
    const availabilitySource = (raw.availability && typeof raw.availability === 'object'
      ? raw.availability
      : raw) as Record<string, unknown>

    return {
      availability: {
        binaryAvailable: availabilitySource.binaryAvailable === true,
        version: typeof availabilitySource.version === 'string' ? availabilitySource.version : null,
        binaryPath: typeof availabilitySource.binaryPath === 'string' ? availabilitySource.binaryPath : null,
      },
      projectState: (raw.projectState && typeof raw.projectState === 'object'
        ? raw.projectState
        : null) as TdStatus['projectState'],
      projectConfig: (raw.projectConfig && typeof raw.projectConfig === 'object'
        ? raw.projectConfig
        : null) as TdStatus['projectConfig'],
    }
  }, [])

  // Fetch reference data (projects, worktrees, config - rarely changes)
  const fetchReferenceData = useCallback(async () => {
    try {
      const [worktreesRes, projectsRes, configRes] = await Promise.all([
        fetch('/api/worktrees', { credentials: 'include' }),
        fetch('/api/projects', { credentials: 'include' }),
        fetch('/api/config', { credentials: 'include' }),
      ])

      if (!worktreesRes.ok || !projectsRes.ok) {
        setError('Failed to load reference data from server.')
        return
      }

      const [worktreesData, projectsData] = await Promise.all([
        worktreesRes.json(),
        projectsRes.json(),
      ])

      setWorktrees(worktreesData)
      // Sort projects alphabetically by name (case-insensitive)
      const sortedProjects = (projectsData.projects || []).sort((a: Project, b: Project) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      )
      setProjects(sortedProjects)

      if (configRes.ok) {
        const configData = await configRes.json()
        setConfig(mapBackendToFrontend(configData))
      }
      setConfigLoading(false)
    } catch (err) {
      console.error('Failed to fetch reference data:', err)
      setError('Failed to load data from server. Check your connection.')
      setConfigLoading(false)
    }
  }, [])

  // Full data fetch - used on initial load and after mutations
  const fetchData = useCallback(async () => {
    await Promise.all([fetchSessionData(), fetchReferenceData()])
  }, [fetchSessionData, fetchReferenceData])

  // Fetch agents from /api/agents
  const fetchAgents = useCallback(async () => {
    try {
      setAgentsLoading(true)
      const res = await fetch('/api/agents?includeDisabled=true', { credentials: 'include' })
      if (res.ok) {
        const data: AgentsConfig = await res.json()
        setAgents(data.agents)
        setDefaultAgentId(data.defaultAgentId)
      }
    } catch (err) {
      console.error('Failed to fetch agents:', err)
    } finally {
      setAgentsLoading(false)
    }
  }, [])

  // TD Integration fetchers
  const fetchTdStatus = useCallback(async () => {
    setTdStatusLoading(true)
    try {
      const res = await fetch('/api/td/status', { credentials: 'include' })
      if (!res.ok) {
        setTdStatus(null)
        return
      }

      const data = await res.json()
      setTdStatus(normalizeTdStatus(data))
    } catch (err) {
      console.error('Failed to fetch td status:', err)
      setTdStatus(null)
    } finally {
      setTdStatusLoading(false)
    }
  }, [normalizeTdStatus])

  const fetchProjectConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/project/config', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setProjectConfig(data.config || {})
        setProjectConfigPath(data.configPath || null)
      } else {
        setProjectConfig(null)
        setProjectConfigPath(null)
      }
    } catch (err) {
      console.error('Failed to fetch project config:', err)
      setProjectConfig(null)
      setProjectConfigPath(null)
    }
  }, [])

  const saveProjectConfigAction = useCallback(async (nextConfig: ProjectConfig): Promise<boolean> => {
    try {
      const res = await fetch('/api/project/config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: nextConfig }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save project config')
        return false
      }

      const data = await res.json().catch(() => ({}))
      setProjectConfig(nextConfig)
      setProjectConfigPath(data.configPath || null)
      await fetchTdStatus()
      return true
    } catch (err) {
      console.error('Failed to save project config:', err)
      setError('Failed to save project config. Check your connection.')
      return false
    }
  }, [fetchTdStatus])

  const initializeTdProject = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/td/init', {
        method: 'POST',
        credentials: 'include',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to initialize td')
        return false
      }

      await Promise.all([fetchTdStatus(), fetchProjectConfig()])
      return true
    } catch (err) {
      console.error('Failed to initialize td:', err)
      setError('Failed to initialize td. Check your connection.')
      return false
    }
  }, [fetchProjectConfig, fetchTdStatus])

  const fetchTdPrompts = useCallback(async (scope: 'project' | 'global' | 'effective' | 'all' = 'project'): Promise<TdPromptTemplate[]> => {
    try {
      const res = await fetch(`/api/td/prompts?scope=${scope}`, { credentials: 'include' })
      if (!res.ok) return []
      const data = await res.json()
      return data.templates || []
    } catch (err) {
      console.error('Failed to fetch td prompts:', err)
      return []
    }
  }, [])

  const saveTdPrompt = useCallback(async (name: string, content: string, scope: 'project' | 'global' = 'project'): Promise<boolean> => {
    try {
      const res = await fetch('/api/td/prompts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content, scope }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save prompt template')
        return false
      }
      return true
    } catch (err) {
      console.error('Failed to save td prompt:', err)
      setError('Failed to save prompt template. Check your connection.')
      return false
    }
  }, [])

  const deleteTdPrompt = useCallback(async (name: string, scope: 'project' | 'global' = 'project'): Promise<boolean> => {
    try {
      const res = await fetch(`/api/td/prompts/${encodeURIComponent(name)}?scope=${scope}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to delete prompt template')
        return false
      }
      return true
    } catch (err) {
      console.error('Failed to delete td prompt:', err)
      setError('Failed to delete prompt template. Check your connection.')
      return false
    }
  }, [])

  const fetchTdIssues = useCallback(async (options?: { status?: string; type?: string; parentId?: string }) => {
    try {
      const params = new URLSearchParams()
      if (options?.status) params.set('status', options.status)
      if (options?.type) params.set('type', options.type)
      if (options?.parentId) params.set('parentId', options.parentId)
      const qs = params.toString()
      const res = await fetch(`/api/td/issues${qs ? `?${qs}` : ''}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setTdIssues(data.issues)
      }
    } catch (err) {
      console.error('Failed to fetch td issues:', err)
    }
  }, [])

  const fetchTdBoard = useCallback(async () => {
    try {
      const res = await fetch('/api/td/board', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setTdBoardView(data.board)
      }
    } catch (err) {
      console.error('Failed to fetch td board:', err)
    }
  }, [])

  const openTaskBoard = useCallback(() => {
    // Remember the active session so closing the board can return to it.
    setTaskBoardReturnSessionId(focusedSessionId || selectedSessions[0] || null)
    setConversationViewOpen(false)
    setConversationInitialSessionId(null)
    setConversationTaskFilterId(null)
    // Clear session selection to indicate task board view
    setSelectedSessions([])
    setFocusedSessionId(null)
    setContextSidebarSessionId(null)
    setTaskBoardOpen(true)
  }, [focusedSessionId, selectedSessions])
  const closeTaskBoard = useCallback(() => {
    setTaskBoardOpen(false)

    // Restore the session that was visible before opening the task board, when still available.
    if (selectedSessions.length === 0 && taskBoardReturnSessionId && sessions.some(s => s.id === taskBoardReturnSessionId)) {
      setSelectedSessions([taskBoardReturnSessionId])
      setFocusedSessionId(taskBoardReturnSessionId)
      if (sessionsWithSidebarOpen.has(taskBoardReturnSessionId)) {
        setContextSidebarSessionId(taskBoardReturnSessionId)
      } else {
        setContextSidebarSessionId(null)
      }
    }

    setTaskBoardReturnSessionId(null)
  }, [selectedSessions.length, taskBoardReturnSessionId, sessions, sessionsWithSidebarOpen])
  const openConversationView = useCallback((context?: { sessionId?: string; taskId?: string }) => {
    setTaskBoardOpen(false)
    setTaskBoardReturnSessionId(null)
    setConversationInitialSessionId(context?.sessionId || null)
    setConversationTaskFilterId(context?.taskId || null)
    setConversationViewOpen(true)
  }, [])
  const closeConversationView = useCallback(() => {
    setConversationViewOpen(false)
    setConversationInitialSessionId(null)
    setConversationTaskFilterId(null)
  }, [])
  const dismissTdReviewNotification = useCallback((issueId: string) => {
    setTdReviewNotifications(prev => prev.filter(n => n.id !== issueId))
  }, [])
  const dismissAllTdReviewNotifications = useCallback(() => {
    setTdReviewNotifications([])
  }, [])

  // Save (create or update) an agent
  const saveAgent = async (agent: AgentConfig): Promise<boolean> => {
    try {
      const isNew = !agents.some(a => a.id === agent.id)
      const url = isNew ? '/api/agents' : `/api/agents/${agent.id}`
      const method = isNew ? 'POST' : 'PUT'

      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agent)
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save agent')
        return false
      }

      const data = await res.json().catch(() => ({}))
      if (data.defaultChangedFrom && data.defaultChangedTo) {
        const fromAgent = agents.find(a => a.id === data.defaultChangedFrom)
        const toAgent = agents.find(a => a.id === data.defaultChangedTo)
        setError(
          `Default agent changed to ${toAgent?.name || data.defaultChangedTo} because ${fromAgent?.name || data.defaultChangedFrom} was disabled.`
        )
      }

      await fetchAgents()
      return true
    } catch (e) {
      console.error(e)
      setError('Failed to save agent. Check your connection.')
      return false
    }
  }

  // Delete an agent
  const deleteAgentAction = async (agentId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to delete agent')
        return false
      }

      await fetchAgents()
      return true
    } catch (e) {
      console.error(e)
      setError('Failed to delete agent. Check your connection.')
      return false
    }
  }

  // Set default agent
  const setDefaultAgentIdAction = async (agentId: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/agents/default', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agentId })
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to set default agent')
        return false
      }

      setDefaultAgentId(agentId)
      return true
    } catch (e) {
      console.error(e)
      setError('Failed to set default agent. Check your connection.')
      return false
    }
  }

  // Socket.IO event handlers
  useEffect(() => {
    socket.on('connect', () => {
      setConnectionStatus('connected')
      fetchSessionData()
    })
    socket.on('disconnect', () => setConnectionStatus('disconnected'))
    socket.on('connect_error', () => setConnectionStatus('error'))
    // Use debounced session fetch for socket events - prevents API storm
    // Only fetches sessions/state (2 calls), not full data (5 calls)
    socket.on('session_update', debouncedFetchSessionData)
    socket.on('td_review_ready', (data: {issues: Array<{id: string; title: string; priority: string}>}) => {
      setTdReviewNotifications(prev => {
        const existingIds = new Set(prev.map(n => n.id))
        const newOnes = data.issues.filter(i => !existingIds.has(i.id))
        return newOnes.length > 0 ? [...prev, ...newOnes] : prev
      })
    })

    // Connect socket now that auth is complete (AppProvider only mounts after auth)
    socket.connect()

    // Initial full fetch on mount
    fetchData()
    fetchAgents()

    return () => {
      socket.off('connect')
      socket.off('disconnect')
      socket.off('connect_error')
      socket.off('session_update')
      socket.off('td_review_ready')
      debouncedFetchSessionData.cancel()
    }
  }, [fetchData, fetchAgents, fetchSessionData, debouncedFetchSessionData])

  // Keep project-specific td/config state in sync with selected project
  // Always fetch td status (availability is system-wide), only clear project-specific state
  useEffect(() => {
    if (!currentProject) {
      setProjectConfig(null)
      setProjectConfigPath(null)
    } else {
      fetchProjectConfig()
    }

    // Always fetch — availability is system-wide, projectState/projectConfig will be null when no project
    fetchTdStatus()
  }, [currentProject?.path, fetchProjectConfig, fetchTdStatus])

  // Clean up stale sessions from sidebar preferences and tab state
  useEffect(() => {
    if (sessions.length > 0) {
      const sessionIds = new Set(sessions.map(s => s.id))

      // Clear current sidebar if session no longer exists
      if (contextSidebarSessionId && !sessionIds.has(contextSidebarSessionId)) {
        setContextSidebarSessionId(null)
      }

      // Remove stale sessions from sidebar preferences
      const staleSidebarIds = [...sessionsWithSidebarOpen].filter(id => !sessionIds.has(id))
      if (staleSidebarIds.length > 0) {
        setSessionsWithSidebarOpen(prev => {
          const next = new Set(prev)
          staleSidebarIds.forEach(id => next.delete(id))
          return next
        })
      }

      // Remove stale sessions from tab preferences
      const staleTabIds = Object.keys(sessionContextTabs).filter(id => !sessionIds.has(id))
      if (staleTabIds.length > 0) {
        setSessionContextTabsState(prev => {
          const next = { ...prev }
          staleTabIds.forEach(id => delete next[id])
          localStorage.setItem('cacd_sessionContextTabs', JSON.stringify(next))
          return next
        })
      }
    }
  }, [sessions, contextSidebarSessionId, sessionsWithSidebarOpen, setSessionsWithSidebarOpen, sessionContextTabs])

  const selectProject = async (path: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/project/select', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to select project')
        return false
      }
      setSelectedSessions([])
      await fetchData()
      // td status and project config are fetched by the useEffect watching currentProject.path
      return true
    } catch (e) {
      console.error(e)
      setError('Failed to select project. Check your connection.')
      return false
    }
  }

  const selectSession = (sessionId: string) => {
    // Close task board and conversation view when selecting a session
    setTaskBoardOpen(false)
    setTaskBoardReturnSessionId(null)
    setConversationViewOpen(false)
    setConversationInitialSessionId(null)
    setConversationTaskFilterId(null)
    setSelectedSessions([sessionId])
    setFocusedSessionId(sessionId)
    // Restore per-session sidebar preference
    if (sessionsWithSidebarOpen.has(sessionId)) {
      setContextSidebarSessionId(sessionId)
    } else {
      setContextSidebarSessionId(null)
    }
  }

  const deselectSession = (sessionId: string) => {
    setSelectedSessions(prev => {
      const newSessions = prev.filter(id => id !== sessionId)
      // If we removed the focused session, focus the first remaining one
      if (focusedSessionId === sessionId && newSessions.length > 0) {
        setFocusedSessionId(newSessions[0])
      } else if (newSessions.length === 0) {
        setFocusedSessionId(null)
      }
      return newSessions
    })
    if (contextSidebarSessionId === sessionId) {
      setContextSidebarSessionId(null)
    }
  }

  const toggleSession = (sessionId: string) => {
    setSelectedSessions(prev => {
      if (prev.includes(sessionId)) {
        // Deselecting a session
        const newSessions = prev.filter(id => id !== sessionId)
        if (focusedSessionId === sessionId && newSessions.length > 0) {
          setFocusedSessionId(newSessions[0])
        }
        // If deselected session had context sidebar open, close it
        if (contextSidebarSessionId === sessionId) {
          setContextSidebarSessionId(null)
        }
        return newSessions
      }
      // Selecting a session
      const newSessions = [...prev, sessionId]
      setFocusedSessionId(sessionId)
      // Don't auto-open/close context sidebar - respect user's preference
      return newSessions
    })
  }

  const clearSessions = () => {
    setSelectedSessions([])
    setFocusedSessionId(null)
    setContextSidebarSessionId(null)
  }

  const focusSession = (sessionId: string) => {
    setFocusedSessionId(sessionId)
    // Restore per-session sidebar preference
    if (sessionsWithSidebarOpen.has(sessionId)) {
      setContextSidebarSessionId(sessionId)
    } else {
      setContextSidebarSessionId(null)
    }
  }

  const toggleSidebar = () => setSidebarOpen(prev => !prev)
  const collapseSidebar = () => setSidebarCollapsed(true)
  const expandSidebar = () => setSidebarCollapsed(false)

  const openContextSidebar = (sessionId: string) => {
    setContextSidebarSessionId(sessionId)
    setSessionsWithSidebarOpen(prev => new Set([...prev, sessionId]))
  }
  const closeContextSidebar = () => {
    // Remove current session from sidebar preferences
    if (contextSidebarSessionId) {
      setSessionsWithSidebarOpen(prev => {
        const next = new Set(prev)
        next.delete(contextSidebarSessionId)
        return next
      })
    }
    setContextSidebarSessionId(null)
  }
  const toggleContextSidebar = (sessionId: string) => {
    if (contextSidebarSessionId === sessionId) {
      // Closing - remove from preferences
      setSessionsWithSidebarOpen(prev => {
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
      setContextSidebarSessionId(null)
    } else {
      // Opening - add to preferences
      setSessionsWithSidebarOpen(prev => new Set([...prev, sessionId]))
      setContextSidebarSessionId(sessionId)
    }
  }

  const setTheme = (t: ThemeType) => setThemeState(t)
  const setFont = (f: FontType) => setFontState(f)
  const setFontScale = (s: number) => setFontScaleState(s)

  const createSession = async (path: string, presetId?: string, sessionName?: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/session/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, presetId, sessionName })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create session')
        return false
      }
      if (data.success) {
        await fetchData()
        setSelectedSessions([data.id])
        setFocusedSessionId(data.id)
        // Auto-open context sidebar for new sessions - but not on mobile
        const isMobileView = typeof window !== 'undefined' && window.innerWidth < 768
        if (!isMobileView) {
          setContextSidebarSessionId(data.id)
          setSessionsWithSidebarOpen(prev => new Set([...prev, data.id]))
        }
        // Close left sidebar on mobile after creating session
        if (isMobileView) {
          setSidebarOpen(false)
        }
        return true
      }
      return false
    } catch (e) {
      console.error(e)
      setError('Failed to create session. Check your connection.')
      return false
    }
  }

  // Create session with new agent system
  const createSessionWithAgent = async (
    path: string,
    agentId: string,
    options?: Record<string, boolean | string>,
    sessionName?: string,
    taskListName?: string,
    tdTaskId?: string,
    promptTemplate?: string,
    intent?: 'work' | 'review' | 'manual'
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/session/create-with-agent', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, agentId, options: options || {}, sessionName, taskListName, tdTaskId, promptTemplate, intent })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create session')
        return false
      }
      if (data.success) {
        await fetchData()
        setSelectedSessions([data.id])
        setFocusedSessionId(data.id)
        // Auto-open context sidebar for new sessions - but not on mobile
        const isMobileView = typeof window !== 'undefined' && window.innerWidth < 768
        if (!isMobileView) {
          setContextSidebarSessionId(data.id)
          setSessionsWithSidebarOpen(prev => new Set([...prev, data.id]))
        }
        // Close left sidebar on mobile after creating session
        if (isMobileView) {
          setSidebarOpen(false)
        }
        return true
      }
      return false
    } catch (e) {
      console.error(e)
      setError('Failed to create session. Check your connection.')
      return false
    }
  }

  const renameSession = async (sessionId: string, name: string): Promise<boolean> => {
    try {
      const normalizedName = name.trim()
      const res = await fetch('/api/session/rename', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, name: normalizedName || undefined })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to rename session')
        return false
      }

      // Update local state immediately; socket event will still refresh from backend
      setSessions(prev =>
        prev.map(session =>
          session.id === sessionId
            ? { ...session, name: normalizedName || undefined }
            : session
        )
      )
      return true
    } catch (e) {
      console.error(e)
      setError('Failed to rename session. Check your connection.')
      return false
    }
  }

  const stopSession = async (sessionId: string) => {
    try {
      const res = await fetch('/api/session/stop', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId })
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to stop session')
        return
      }
      await fetchData()
    } catch (e) {
      console.error(e)
      setError('Failed to stop session. Check your connection.')
    }
  }

  const restartSession = async (sessionId: string) => {
    try {
      const res = await fetch('/api/session/restart', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to restart session')
        return
      }
      await fetchData()
      if (typeof data.notice === 'string' && data.notice.trim().length > 0) {
        setError(data.notice)
      }
    } catch (e) {
      console.error(e)
      setError('Failed to restart session. Check your connection.')
    }
  }

  const clearError = () => setError(null)

  // Inline View actions
  const openAddProject = () => setAddProjectOpen(true)
  const closeAddProject = () => setAddProjectOpen(false)
  const openAddWorktree = (projectPath?: string) => {
    setAddWorktreeProjectPath(projectPath || null)
    setAddWorktreeOpen(true)
  }
  const closeAddWorktree = () => {
    setAddWorktreeOpen(false)
    setAddWorktreeProjectPath(null)
  }
  const openAddSession = (worktreePath?: string, projectPath?: string, tdTaskId?: string, context?: AddSessionContext) => {
    const taskCreatedBranch = context?.createdBranch || tdIssues.find(issue => issue.id === tdTaskId)?.created_branch
    const inferredWorktreePath =
      worktreePath ||
      resolveTdIssueWorktreePath(worktrees, taskCreatedBranch, projectPath || currentProject?.path || undefined)

    setAddSessionWorktreePath(inferredWorktreePath || null)
    setAddSessionProjectPath(projectPath || null)
    setAddSessionTdTaskId(tdTaskId || null)
    setAddSessionIntent(context?.intent || null)
    setAddSessionSessionName(context?.sessionName || null)
    setAddSessionOpen(true)
  }
  const closeAddSession = () => {
    setAddSessionOpen(false)
    setAddSessionWorktreePath(null)
    setAddSessionProjectPath(null)
    setAddSessionTdTaskId(null)
    setAddSessionIntent(null)
    setAddSessionSessionName(null)
  }
  const openSettings = (section?: 'general' | 'agents' | 'status-hooks' | 'worktree-hooks' | 'td' | 'project') => {
    const targetSection = section || (settingsSection === 'project' ? 'general' : settingsSection)
    if (settingsSection !== targetSection) {
      setSettingsSection(targetSection)
    }
    localStorage.setItem('cacd_settings_section', targetSection)
    setSettingsOpen(true)
  }
  const closeSettings = () => setSettingsOpen(false)
  const navigateSettings = (section: 'general' | 'agents' | 'status-hooks' | 'worktree-hooks' | 'td' | 'project') => {
    setSettingsSection(section)
    localStorage.setItem('cacd_settings_section', section)
  }

  const openFileDiff = (sessionId: string, file: ChangedFile, worktreePath: string) => {
    setViewingFileDiff({ sessionId, file, worktreePath })
  }
  const closeFileDiff = () => setViewingFileDiff(null)

  const openFile = (worktreePath: string, filePath: string) => {
    setViewingFile({ worktreePath, filePath })
  }
  const closeFile = () => setViewingFile(null)

  const updateConfig = async (newConfig: AppConfig): Promise<boolean> => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapFrontendToBackend(newConfig))
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save configuration')
        return false
      }
      setConfig(newConfig)
      return true
    } catch (e) {
      console.error(e)
      setError('Failed to save configuration. Check your connection.')
      return false
    }
  }

  const addProject = async (path: string, name?: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/project/add', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, name })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to add project')
        return false
      }
      if (data.success) {
        await fetchData()
        return true
      }
      return false
    } catch (e) {
      console.error(e)
      setError('Failed to add project. Check your connection.')
      return false
    }
  }

  const updateProject = async (path: string, name: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/project/update', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, name })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update project')
        return false
      }
      if (data.success) {
        // Update local state optimistically
        setProjects(prev =>
          prev.map(p => p.path === path ? { ...p, name } : p)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        )
        return true
      }
      return false
    } catch (e) {
      console.error(e)
      setError('Failed to update project. Check your connection.')
      return false
    }
  }

  const removeProject = async (path: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/project/remove', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to remove project')
        return false
      }
      if (data.success) {
        await fetchData()
        return true
      }
      return false
    } catch (e) {
      console.error(e)
      setError('Failed to remove project. Check your connection.')
      return false
    }
  }

  const createWorktree = async (
    path: string,
    branch: string,
    baseBranch: string,
    copySessionData: boolean,
    copyClaudeDirectory: boolean,
    projectPath?: string
  ): Promise<boolean> => {
    try {
      const res = await fetch('/api/worktree/create', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, branch, baseBranch, copySessionData, copyClaudeDirectory, projectPath })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create worktree')
        return false
      }
      if (data.success) {
        await fetchData()
        return true
      }
      return false
    } catch (e) {
      console.error(e)
      setError('Failed to create worktree. Check your connection.')
      return false
    }
  }

  const deleteWorktree = async (path: string, deleteBranch: boolean, projectPath?: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/worktree/delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, deleteBranch, projectPath })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to delete worktree')
        return false
      }
      if (data.success) {
        await fetchData()
        return true
      }
      return false
    } catch (e) {
      console.error(e)
      setError('Failed to delete worktree. Check your connection.')
      return false
    }
  }

  const store: AppStore = {
    // State
    projects,
    worktrees,
    sessions,
    currentProject,
    agents,
    defaultAgentId,
    agentsLoading,
    selectedSessions,
    focusedSessionId,
    sidebarOpen,
    sidebarCollapsed,
    contextSidebarSessionId,
    sessionContextTabs,
    addProjectOpen,
    addWorktreeOpen,
    addWorktreeProjectPath,
    addSessionOpen,
    addSessionWorktreePath,
    addSessionProjectPath,
    addSessionTdTaskId,
    addSessionIntent,
    addSessionSessionName,
    settingsOpen,
    settingsSection,
    viewingFileDiff,
    viewingFile,
    config,
    configLoading,
    theme,
    font,
    fontScale,
    connectionStatus,
    isDevMode,
    error,
    socket,

    // Actions
    fetchData,
    fetchAgents,
    selectProject,
    selectSession,
    deselectSession,
    toggleSession,
    clearSessions,
    focusSession,
    toggleSidebar,
    collapseSidebar,
    expandSidebar,
    openContextSidebar,
    closeContextSidebar,
    toggleContextSidebar,
    setSessionContextTab,
    openAddProject,
    closeAddProject,
    openAddWorktree,
    closeAddWorktree,
    openAddSession,
    closeAddSession,
    openSettings,
    closeSettings,
    navigateSettings,
    openFileDiff,
    closeFileDiff,
    openFile,
    closeFile,
    updateConfig,
    setTheme,
    setFont,
    setFontScale,
    createSession,
    createSessionWithAgent,
    renameSession,
    stopSession,
    restartSession,
    addProject,
    updateProject,
    removeProject,
    createWorktree,
    deleteWorktree,
    clearError,
    saveAgent,
    deleteAgent: deleteAgentAction,
    setDefaultAgentId: setDefaultAgentIdAction,
    // TD Integration
    tdStatus,
    tdStatusLoading,
    tdIssues,
    tdBoardView,
    taskBoardOpen,
    conversationViewOpen,
    conversationInitialSessionId,
    conversationTaskFilterId,
    projectConfig,
    projectConfigPath,
    fetchTdStatus,
    fetchProjectConfig,
    saveProjectConfig: saveProjectConfigAction,
    initializeTdProject,
    fetchTdPrompts,
    saveTdPrompt,
    deleteTdPrompt,
    fetchTdIssues,
    fetchTdBoard,
    openTaskBoard,
    closeTaskBoard,
    openConversationView,
    closeConversationView,
    tdReviewNotifications,
    dismissTdReviewNotification,
    dismissAllTdReviewNotifications,
  }

  return <AppContext.Provider value={store}>{children}</AppContext.Provider>
}

export function useAppStore() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useAppStore must be used within an AppProvider')
  }
  return context
}

export { socket }
