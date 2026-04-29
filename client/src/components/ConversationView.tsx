import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { apiFetch } from '@/lib/apiFetch'
import { useAppStore } from '@/lib/store'
import { AgentIcon } from '@/components/AgentIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type {
  ConversationMessage,
  ConversationMessagesResponse,
  ConversationSession,
  ConversationSessionMetadata,
} from '@/lib/types'
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  Filter,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Shield,
  User,
  Wrench,
  X,
} from 'lucide-react'

const SESSION_PAGE_SIZE = 50
const MESSAGE_PAGE_SIZE = 120

interface ConversationDetailState {
  metadata: ConversationSessionMetadata
  messages: ConversationMessage[]
  total: number
  missingSessionFile: boolean
  subAgentSessions: string[]
}

function startOfDay(date: Date): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function startOfWeekMonday(date: Date): Date {
  const result = startOfDay(date)
  const day = result.getDay()
  const delta = day === 0 ? -6 : 1 - day
  result.setDate(result.getDate() + delta)
  return result
}

function formatDuration(createdAt: number, endedAt?: number | null): string {
  const end = endedAt || Math.floor(Date.now() / 1000)
  const diff = Math.max(0, end - createdAt)
  const minutes = Math.floor(diff / 60)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSessionTime(createdAt: number, endedAt?: number | null): string {
  return `${formatTime(createdAt)} · ${formatDuration(createdAt, endedAt)}`
}

function toMonthLabel(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  })
}

function formatTokenCount(tokens?: number): string | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) return null
  return `${tokens.toLocaleString()} tokens`
}

function formatCost(cost?: number): string | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost)) return null
  return `$${cost.toFixed(2)}`
}

function toInlinePreview(value?: string | null, maxLength = 96): string | null {
  if (!value) return null
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function groupSessionsByDate(sessions: ConversationSession[]): Array<{ label: string; sessions: ConversationSession[] }> {
  const now = new Date()
  const todayStart = startOfDay(now)
  const yesterdayStart = new Date(todayStart)
  yesterdayStart.setDate(yesterdayStart.getDate() - 1)

  const thisWeekStart = startOfWeekMonday(now)
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)

  const groups = new Map<string, ConversationSession[]>()

  for (const session of sessions) {
    const createdAtDate = new Date(session.createdAt * 1000)
    const createdAtDay = startOfDay(createdAtDate)

    let label: string
    if (createdAtDay.getTime() === todayStart.getTime()) {
      label = 'Today'
    } else if (createdAtDay.getTime() === yesterdayStart.getTime()) {
      label = 'Yesterday'
    } else if (createdAtDay >= thisWeekStart) {
      label = 'This Week'
    } else if (createdAtDay >= lastWeekStart && createdAtDay < thisWeekStart) {
      label = 'Last Week'
    } else {
      label = toMonthLabel(session.createdAt)
    }

    const bucket = groups.get(label) || []
    bucket.push(session)
    groups.set(label, bucket)
  }

  const preferredOrder = ['Today', 'Yesterday', 'This Week', 'Last Week']
  const customLabels = [...groups.keys()]
    .filter(label => !preferredOrder.includes(label))
    .sort((a, b) => {
      const aDate = new Date(`1 ${a}`)
      const bDate = new Date(`1 ${b}`)
      return bDate.getTime() - aDate.getTime()
    })

  const orderedLabels = [
    ...preferredOrder.filter(label => groups.has(label)),
    ...customLabels,
  ]

  return orderedLabels.map(label => ({
    label,
    sessions: (groups.get(label) || []).sort((a, b) => b.createdAt - a.createdAt),
  }))
}

function getRoleIcon(role: ConversationMessage['role']) {
  if (role === 'user') return User
  if (role === 'assistant') return Bot
  if (role === 'tool') return Wrench
  return Shield
}

interface SessionEntryProps {
  session: ConversationSession
  selected: boolean
  onSelect: (id: string) => void
}

function SessionEntry({ session, selected, onSelect }: SessionEntryProps) {
  const { agents } = useAppStore()

  const matchingAgent = useMemo(() => {
    return (
      agents.find(agent => agent.id === session.agentProfileId) ||
      agents.find(agent => agent.detectionStrategy === session.agentType)
    )
  }, [agents, session.agentProfileId, session.agentType])

  return (
    <button
      onClick={() => onSelect(session.id)}
      className={cn(
        'w-full rounded border px-3 py-2 text-left transition-colors',
        'hover:bg-accent/40 hover:border-border',
        selected ? 'bg-accent/50 border-border' : 'bg-card border-border/60',
        session.missingSessionFile && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5">
          <AgentIcon
            icon={matchingAgent?.icon}
            iconColor={matchingAgent?.iconColor}
            className="h-3.5 w-3.5"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-medium">
              {session.sessionName || session.contentPreview || `${session.agentProfileName} session`}
            </p>
            {session.isActive && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            )}
          </div>

          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Clock3 className="h-2.5 w-2.5" />
            <span>{formatSessionTime(session.createdAt, session.endedAt)}</span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
              {session.agentProfileName}
            </span>
            {session.branchName && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                {session.branchName}
              </span>
            )}
            {session.tdTaskId && (
              <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-600">
                {session.tdTaskId}
              </span>
            )}
          </div>

          {session.missingSessionFile && (
            <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-600">
              <AlertCircle className="h-2.5 w-2.5" />
              session file deleted
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

export function ConversationView() {
  const {
    projects,
    conversationViewProjectPath,
    closeConversationView,
    conversationInitialSessionId,
    conversationTaskFilterId,
  } = useAppStore()
  const projectName = projects.find(p => p.path === conversationViewProjectPath)?.name
  const [sessions, setSessions] = useState<ConversationSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [enabledAgentTypes, setEnabledAgentTypes] = useState<Set<string>>(new Set())
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [detailBySessionId, setDetailBySessionId] = useState<Record<string, ConversationDetailState>>({})
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailLoadingMore, setDetailLoadingMore] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set())
  const [expandedToolBlocks, setExpandedToolBlocks] = useState<Set<string>>(new Set())
  const [expandedThinkingBlocks, setExpandedThinkingBlocks] = useState<Set<string>>(new Set())
  const deepLinkLookupInFlight = useRef<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)

  const fetchSessions = useCallback(async (reset = false) => {
    if (!conversationViewProjectPath) return

    const nextOffset = reset ? 0 : offset
    if (reset) {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }

    try {
      const params = new URLSearchParams({
        projectPath: conversationViewProjectPath,
        limit: String(SESSION_PAGE_SIZE),
        offset: String(nextOffset),
      })

      if (search.trim()) {
        params.set('search', search.trim())
      }
      if (conversationTaskFilterId) {
        params.set('taskId', conversationTaskFilterId)
      }

      const res = await apiFetch(`/api/conversations?${params.toString()}`)
      if (!res.ok) {
        throw new Error('Failed to load conversations')
      }

      const data = (await res.json()) as {
        sessions: ConversationSession[]
        total: number
      }

      setSessions(prev => {
        if (reset) {
          const next = [...data.sessions]
          if (conversationInitialSessionId) {
            const preservedDeepLinkSession = prev.find(
              session => session.id === conversationInitialSessionId || session.tdSessionId === conversationInitialSessionId
            )
            if (preservedDeepLinkSession && !next.some(session => session.id === preservedDeepLinkSession.id)) {
              next.unshift(preservedDeepLinkSession)
            }
          }
          return next
        }

        if (data.sessions.length === 0) {
          return prev
        }

        const merged = [...prev]
        const indexById = new Map(merged.map((session, index) => [session.id, index]))
        for (const session of data.sessions) {
          const existingIndex = indexById.get(session.id)
          if (existingIndex !== undefined) {
            merged[existingIndex] = session
          } else {
            indexById.set(session.id, merged.length)
            merged.push(session)
          }
        }
        return merged
      })
      setTotal(data.total)
      setOffset(nextOffset + data.sessions.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [conversationInitialSessionId, conversationTaskFilterId, conversationViewProjectPath, offset, search])

  const fetchMessages = useCallback(async (sessionId: string, reset = false, nextOffset = 0) => {
    if (reset) {
      setDetailLoading(true)
      setDetailError(null)
      setExpandedMessages(new Set())
      setExpandedToolBlocks(new Set())
      setExpandedThinkingBlocks(new Set())
    } else {
      setDetailLoadingMore(true)
    }

    try {
      const params = new URLSearchParams({
        limit: String(MESSAGE_PAGE_SIZE),
        offset: String(nextOffset),
      })

      const res = await apiFetch(`/api/conversations/${encodeURIComponent(sessionId)}/messages?${params.toString()}`)
      if (!res.ok) {
        throw new Error('Failed to load messages')
      }

      const data = (await res.json()) as ConversationMessagesResponse

      setDetailBySessionId(prev => {
        const current = prev[sessionId]
        return {
          ...prev,
          [sessionId]: {
            metadata: data.metadata || {},
            total: data.total,
            missingSessionFile: data.missingSessionFile,
            subAgentSessions: data.subAgentSessions || [],
            messages: reset ? data.messages : [...(current?.messages || []), ...data.messages],
          },
        }
      })
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      setDetailLoading(false)
      setDetailLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    setOffset(0)
    void fetchSessions(true)
  }, [conversationTaskFilterId, conversationViewProjectPath, search])

  useEffect(() => {
    if (conversationInitialSessionId) {
      const matchingSession = sessions.find(
        session => session.id === conversationInitialSessionId || session.tdSessionId === conversationInitialSessionId
      )
      if (matchingSession) {
        setSelectedSessionId(matchingSession.id)
        return
      }
      if (deepLinkLookupInFlight.current === conversationInitialSessionId) {
        return
      }

      deepLinkLookupInFlight.current = conversationInitialSessionId
      let cancelled = false
      void (async () => {
        try {
          const res = await apiFetch(`/api/conversations/${encodeURIComponent(conversationInitialSessionId)}`)
          if (!res.ok) return
          const data = (await res.json()) as { session?: ConversationSession }
          if (!data.session || cancelled) return
          setSessions(prev => (prev.some(session => session.id === data.session!.id) ? prev : [data.session!, ...prev]))
          setSelectedSessionId(data.session.id)
        } catch {
          // Best effort for deep-link hydration.
        } finally {
          if (!cancelled && deepLinkLookupInFlight.current === conversationInitialSessionId) {
            deepLinkLookupInFlight.current = null
          }
        }
      })()
      return () => {
        cancelled = true
        if (deepLinkLookupInFlight.current === conversationInitialSessionId) {
          deepLinkLookupInFlight.current = null
        }
      }
    }

    deepLinkLookupInFlight.current = null
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0]?.id || null)
    }
  }, [conversationInitialSessionId, selectedSessionId, sessions])

  useEffect(() => {
    if (!selectedSessionId) return
    void fetchMessages(selectedSessionId, true, 0)
  }, [selectedSessionId, fetchMessages])

  const filteredSessions = useMemo(() => {
    if (enabledAgentTypes.size === 0) {
      return sessions
    }
    return sessions.filter(session => enabledAgentTypes.has(session.agentType))
  }, [sessions, enabledAgentTypes])

  const groupedSessions = useMemo(
    () => groupSessionsByDate(filteredSessions),
    [filteredSessions]
  )

  const selectedSession = useMemo(
    () => filteredSessions.find(session => session.id === selectedSessionId) || null,
    [filteredSessions, selectedSessionId]
  )

  useEffect(() => {
    if (filteredSessions.length === 0) {
      setSelectedSessionId(null)
      return
    }

    if (conversationInitialSessionId && deepLinkLookupInFlight.current === conversationInitialSessionId) {
      return
    }

    if (!selectedSessionId || !filteredSessions.some(session => session.id === selectedSessionId)) {
      setSelectedSessionId(filteredSessions[0]?.id || null)
    }
  }, [conversationInitialSessionId, filteredSessions, selectedSessionId])

  const selectedDetail = useMemo(
    () => (selectedSessionId ? detailBySessionId[selectedSessionId] : null),
    [selectedSessionId, detailBySessionId]
  )
  const selectedModel = useMemo(() => {
    if (selectedDetail?.metadata?.model) {
      return selectedDetail.metadata.model
    }
    const rawModel = selectedSession?.agentOptions?.['model']
    return typeof rawModel === 'string' ? rawModel : undefined
  }, [selectedDetail?.metadata?.model, selectedSession?.agentOptions])

  const groupedTurns = useMemo(() => {
    const messages = selectedDetail?.messages || []
    const turns: Array<{ role: ConversationMessage['role']; messages: ConversationMessage[] }> = []
    for (const message of messages) {
      const last = turns[turns.length - 1]
      if (last && last.role === message.role) {
        last.messages.push(message)
      } else {
        turns.push({ role: message.role, messages: [message] })
      }
    }
    return turns
  }, [selectedDetail?.messages])
  const selectedSubAgentSessions = selectedDetail?.subAgentSessions || []

  const availableAgentTypes = useMemo(() => {
    return Array.from(new Set(sessions.map(session => session.agentType))).sort()
  }, [sessions])

  const toggleAgentType = (agentType: string) => {
    setEnabledAgentTypes(prev => {
      const next = new Set(prev)
      if (next.has(agentType)) {
        next.delete(agentType)
      } else {
        next.add(agentType)
      }
      return next
    })
  }

  const onListScroll = () => {
    const element = listRef.current
    if (!element || loading || loadingMore) return
    if (sessions.length >= total) return

    const nearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 80
    if (nearBottom) {
      void fetchSessions(false)
    }
  }

  const clearAgentFilters = () => {
    setEnabledAgentTypes(new Set())
  }

  const toggleMessage = (messageId: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  const toggleToolBlock = (key: string) => {
    setExpandedToolBlocks(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleThinkingBlock = (key: string) => {
    setExpandedThinkingBlocks(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Conversations</span>
          {projectName && (
            <span className="text-xs text-muted-foreground">{projectName}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              setOffset(0)
              void fetchSessions(true)
              if (selectedSessionId) {
                void fetchMessages(selectedSessionId, true, 0)
              }
            }}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={closeConversationView}
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[35%_65%]">
        <div className="flex min-h-0 flex-col border-r border-border">
          <div className="space-y-2 border-b border-border p-2">
            <div className="flex items-center gap-2 rounded border border-border bg-card px-2">
              <Search className="h-3 w-3 text-muted-foreground" />
              <Input
                className="h-7 border-0 px-0 text-xs shadow-none focus-visible:ring-0"
                placeholder="Search by session, branch, task, content"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Filter className="h-2.5 w-2.5" />
                Agent
              </span>
              {availableAgentTypes.map(agentType => (
                <button
                  key={agentType}
                  onClick={() => toggleAgentType(agentType)}
                  className={cn(
                    'rounded border px-2 py-1 text-[10px] whitespace-nowrap transition-colors',
                    enabledAgentTypes.has(agentType)
                      ? 'border-border bg-accent text-foreground'
                      : 'border-border/60 bg-card text-muted-foreground hover:text-foreground'
                  )}
                >
                  {agentType}
                </button>
              ))}
              {enabledAgentTypes.size > 0 && (
                <button
                  onClick={clearAgentFilters}
                  className="rounded border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
            onScroll={onListScroll}
          >
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : error ? (
              <div className="rounded border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-600">
                {error}
              </div>
            ) : groupedSessions.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No conversations found
              </div>
            ) : (
              <div className="space-y-4">
                {groupedSessions.map(group => (
                  <section key={group.label}>
                    <h3 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </h3>
                    <div className="space-y-1.5">
                      {group.sessions.map(session => (
                        <SessionEntry
                          key={session.id}
                          session={session}
                          selected={session.id === selectedSessionId}
                          onSelect={setSelectedSessionId}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {loadingMore && (
                  <div className="flex items-center justify-center py-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 p-3">
          {selectedSession ? (
            <div className="flex h-full min-h-0 flex-col rounded border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <div className="text-sm font-medium">
                  {selectedSession.sessionName || selectedSession.contentPreview || `${selectedSession.agentProfileName} session`}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  <span>{selectedSession.agentProfileName}</span>
                  {selectedSession.branchName && <span>· {selectedSession.branchName}</span>}
                  {selectedSession.tdTaskId && <span>· {selectedSession.tdTaskId}</span>}
                  <span>· {formatSessionTime(selectedSession.createdAt, selectedSession.endedAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  {selectedDetail?.metadata?.messageCount !== undefined && (
                    <span className="rounded bg-muted px-1.5 py-0.5">
                      {selectedDetail.metadata.messageCount} messages
                    </span>
                  )}
                  {formatTokenCount(selectedDetail?.metadata?.totalTokens) && (
                    <span className="rounded bg-muted px-1.5 py-0.5">
                      {formatTokenCount(selectedDetail?.metadata?.totalTokens)}
                    </span>
                  )}
                  {formatCost(selectedDetail?.metadata?.estimatedCostUsd) && (
                    <span className="rounded bg-muted px-1.5 py-0.5">
                      {formatCost(selectedDetail?.metadata?.estimatedCostUsd)}
                    </span>
                  )}
                  {selectedModel && (
                    <span className="rounded bg-muted px-1.5 py-0.5">
                      model:{' '}
                      {selectedModel}
                    </span>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                {detailLoading ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : detailError ? (
                  <div className="rounded border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-600">
                    {detailError}
                  </div>
                ) : selectedDetail?.missingSessionFile ? (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
                    Session file is missing or was deleted. Metadata is still available.
                  </div>
                ) : groupedTurns.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    No parsed messages available for this session
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedSubAgentSessions.length > 0 && (
                      <div className="rounded border border-border/70 bg-muted/30 p-2 text-[10px] text-muted-foreground">
                        <div className="mb-1 font-medium text-foreground">Subagent sessions</div>
                        <div className="flex flex-wrap gap-1">
                          {selectedSubAgentSessions.map(subSession => (
                            <span key={subSession} className="rounded bg-muted px-1.5 py-0.5">
                              {subSession}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {groupedTurns.map((turn, turnIndex) => {
                      const RoleIcon = getRoleIcon(turn.role)
                      return (
                        <div key={`${turn.role}-${turnIndex}`} className="rounded border border-border/70 p-2">
                          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <RoleIcon className="h-3 w-3" />
                            <span className="uppercase">{turn.role}</span>
                            <span>({turn.messages.length})</span>
                          </div>

                          <div className="space-y-2">
                            {turn.messages.map(message => {
                              const isExpanded = expandedMessages.has(message.id)
                              return (
                                <div key={message.id} className="rounded border border-border/60 bg-background px-2 py-1.5">
                                  <button
                                    className="flex w-full items-start gap-2 text-left"
                                    onClick={() => toggleMessage(message.id)}
                                  >
                                    <span className="mt-0.5 text-muted-foreground">
                                      {isExpanded ? (
                                        <ChevronDown className="h-3 w-3" />
                                      ) : (
                                        <ChevronRight className="h-3 w-3" />
                                      )}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                        {message.timestamp !== null && <span>{formatTime(message.timestamp)}</span>}
                                        {message.model && (
                                          <span className="rounded bg-muted px-1 py-0.5">{message.model}</span>
                                        )}
                                      </div>
                                      <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed">
                                        {message.preview || message.content || '[empty]'}
                                      </p>
                                    </div>
                                  </button>

                                  {isExpanded && (
                                    <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
                                      <div className="max-h-[320px] overflow-auto rounded border border-border/60 bg-muted/20 p-2 text-xs">
                                        <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:text-xs">
                                          <ReactMarkdown>
                                          {message.content || message.preview}
                                          </ReactMarkdown>
                                        </div>
                                      </div>

                                      {message.toolCalls?.map((toolCall, index) => {
                                        const key = `${message.id}-tool-${index}`
                                        const open = expandedToolBlocks.has(key)
                                        const inputSummary = toInlinePreview(toolCall.input, 80)
                                        return (
                                          <div
                                            key={key}
                                            className={cn(
                                              'rounded border p-2 text-xs',
                                              toolCall.isError
                                                ? 'border-red-500/40 bg-red-500/10'
                                                : 'border-border/60 bg-muted/20'
                                            )}
                                          >
                                            <button
                                              className="flex w-full min-w-0 items-center gap-1.5 text-left"
                                              onClick={() => toggleToolBlock(key)}
                                            >
                                              {open ? (
                                                <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                              ) : (
                                                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                              )}
                                              <Wrench className="h-3 w-3" />
                                              <span className="font-medium">{toolCall.name}</span>
                                              {inputSummary && (
                                                <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                                                  {inputSummary}
                                                </span>
                                              )}
                                            </button>
                                            {open && (
                                              <div className="mt-2 space-y-2 text-[11px]">
                                                {toolCall.input && (
                                                  <div>
                                                    <div className="mb-1 text-muted-foreground">Input</div>
                                                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-1.5">
                                                      {toolCall.input}
                                                    </pre>
                                                  </div>
                                                )}
                                                {toolCall.output && (
                                                  <div>
                                                    <div className="mb-1 text-muted-foreground">Output</div>
                                                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-1.5">
                                                      {toolCall.output}
                                                    </pre>
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        )
                                      })}

                                      {message.thinkingBlocks?.map((thinkingBlock, index) => {
                                        const key = `${message.id}-thinking-${index}`
                                        const open = expandedThinkingBlocks.has(key)
                                        return (
                                          <div key={key} className="rounded border border-border/60 bg-muted/20 p-2 text-xs">
                                            <button
                                              className="flex w-full items-center gap-1.5 text-left"
                                              onClick={() => toggleThinkingBlock(key)}
                                            >
                                              {open ? (
                                                <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                              ) : (
                                                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                              )}
                                              <span className="font-medium">Thinking</span>
                                              {thinkingBlock.tokenCount !== undefined && (
                                                <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                                                  {thinkingBlock.tokenCount.toLocaleString()} tokens
                                                </span>
                                              )}
                                            </button>
                                            {open && (
                                              <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-background/70 p-1.5 text-[11px]">
                                                {thinkingBlock.content}
                                              </pre>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}

                    {!!selectedDetail && selectedDetail.total > selectedDetail.messages.length && (
                      <div className="flex justify-center pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (selectedSessionId) {
                              void fetchMessages(
                                selectedSessionId,
                                false,
                                selectedDetail?.messages.length || 0
                              )
                            }
                          }}
                          disabled={detailLoadingMore}
                        >
                          {detailLoadingMore ? (
                            <>
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              Loading...
                            </>
                          ) : (
                            `Load More (${selectedDetail.total - selectedDetail.messages.length} remaining)`
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">
              Select a session to view details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
