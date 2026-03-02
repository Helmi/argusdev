import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import {
  formatTdAbsolute,
  formatTdDateValue,
  formatTdRelative,
  parseTdTimestamp,
} from '@/lib/tdTimestamp'
import type { TdIssueWithChildren, TdHandoffParsed } from '@/lib/types'
import {
  getLinkedSessions,
  getTaskDetailLayoutCounts,
  hasSchedulingDetails,
  parseAcceptanceCriteria,
  groupChildrenByStatus,
} from '@/lib/taskDetailLayout'
import type { LucideIcon } from 'lucide-react'
import {
  X,
  Circle,
  CircleDot,
  CheckCircle2,
  PauseCircle,
  AlertCircle,
  ChevronRight,
  FileText,
  Tag,
  Layers,
  Clock,
  Loader2,
  Play,
  Send,
  RotateCcw,
  MessageSquare,
  Wrench,
} from 'lucide-react'

type TaskDetailTab = 'overview' | 'activity' | 'details'

function RelativeTime({ timestamp, nowMs }: { timestamp?: string | null; nowMs: number }) {
  const date = parseTdTimestamp(timestamp ?? '')
  if (!date) return <span>—</span>

  return (
    <time dateTime={date.toISOString()} title={formatTdAbsolute(date)}>
      {formatTdRelative(date, nowMs)}
    </time>
  )
}

const statusConfig: Record<string, { icon: typeof Circle; color: string; bg: string; label: string }> = {
  open: { icon: Circle, color: 'text-muted-foreground', bg: 'bg-muted/50', label: 'Open' },
  in_progress: { icon: CircleDot, color: 'text-blue-500', bg: 'bg-blue-500/20', label: 'In Progress' },
  in_review: { icon: PauseCircle, color: 'text-purple-500', bg: 'bg-purple-500/20', label: 'In Review' },
  closed: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/20', label: 'Closed' },
  blocked: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/20', label: 'Blocked' },
}

const priorityConfig: Record<string, { color: string; label: string }> = {
  P0: { color: 'text-red-500 bg-red-500/10', label: 'Critical' },
  P1: { color: 'text-orange-500 bg-orange-500/10', label: 'High' },
  P2: { color: 'text-muted-foreground bg-muted/50', label: 'Medium' },
  P3: { color: 'text-muted-foreground/50 bg-muted/30', label: 'Low' },
}

function HandoffSection({ handoff, nowMs }: { handoff: TdHandoffParsed; nowMs: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        <RelativeTime timestamp={handoff.timestamp} nowMs={nowMs} />
        {handoff.sessionId && (
          <span className="font-mono">{handoff.sessionId}</span>
        )}
      </div>

      {handoff.done.length > 0 && (
        <div>
          <span className="text-xs font-medium text-green-500">Done</span>
          <ul className="mt-1 space-y-0.5">
            {handoff.done.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {handoff.remaining.length > 0 && (
        <div>
          <span className="text-xs font-medium text-orange-500">Remaining</span>
          <ul className="mt-1 space-y-0.5">
            {handoff.remaining.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Circle className="h-3 w-3 text-orange-500 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {handoff.decisions.length > 0 && (
        <div>
          <span className="text-xs font-medium text-blue-500">Decisions</span>
          <ul className="mt-1 space-y-0.5">
            {handoff.decisions.map((item, i) => (
              <li key={i} className="text-xs text-muted-foreground pl-4">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {handoff.uncertain.length > 0 && (
        <div>
          <span className="text-xs font-medium text-yellow-500">Uncertain</span>
          <ul className="mt-1 space-y-0.5">
            {handoff.uncertain.map((item, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertCircle className="h-3 w-3 text-yellow-500 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

interface CollapsibleSectionProps {
  title: string
  icon?: LucideIcon
  defaultOpen?: boolean
  count?: number
  children: ReactNode
}

function CollapsibleSection({ title, icon: Icon, defaultOpen = false, count, children }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <section className="rounded-md border border-border bg-card/40 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-accent/40 transition-colors"
        onClick={() => setIsOpen(open => !open)}
      >
        <span className="flex items-center gap-2 min-w-0">
          <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform', isOpen && 'rotate-90')} />
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground truncate">{title}</span>
        </span>
        {typeof count === 'number' && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{count}</span>
        )}
      </button>
      {isOpen && (
        <div className="px-3 py-2 border-t border-border">
          {children}
        </div>
      )}
    </section>
  )
}

interface TaskDetailModalProps {
  issueId: string
  onClose: () => void
  onNavigate?: (issueId: string) => void
  onStartWorking?: (issueId: string) => void
  onStartReview?: (issueId: string, createdBranch?: string) => void
  onRefresh?: () => void
}

export function TaskDetailModal({ issueId, onClose, onNavigate, onStartWorking, onStartReview, onRefresh }: TaskDetailModalProps) {
  const { openConversationView, currentProject } = useAppStore()
  const [issue, setIssue] = useState<TdIssueWithChildren | null>(null)
  const [loading, setLoading] = useState(true)
  const [isVisible, setIsVisible] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [showCommentInput, setShowCommentInput] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [activeTab, setActiveTab] = useState<TaskDetailTab>('overview')
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Animate in
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10)
    return () => clearTimeout(timer)
  }, [])

  // Close with animation
  const handleClose = useCallback(() => {
    setIsVisible(false)
    setTimeout(onClose, 200)
  }, [onClose])

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // Fetch issue details
  useEffect(() => {
    setLoading(true)
    setActiveTab('overview')
    setShowCommentInput(false)
    setCommentText('')
    fetch(`/api/td/issues/${issueId}`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => setIssue(data.issue || null))
      .catch(() => setIssue(null))
      .finally(() => setLoading(false))
  }, [issueId])

  const status = issue ? statusConfig[issue.status] : null
  const StatusIcon = status?.icon || Circle
  const priority = issue ? priorityConfig[issue.priority] : null
  const labels = issue?.labels ? issue.labels.split(',').map(label => label.trim()).filter(Boolean) : []
  const linkedSessions = issue ? getLinkedSessions(issue) : []
  const acceptanceCriteria = issue ? parseAcceptanceCriteria(issue.acceptance) : []
  const hasScheduling = issue ? hasSchedulingDetails(issue) : false
  const children = Array.isArray(issue?.children) ? issue.children : []
  const handoffs = Array.isArray(issue?.handoffs) ? issue.handoffs : []
  const comments = issue && Array.isArray(issue.comments) ? issue.comments : []
  const files = Array.isArray(issue?.files) ? issue.files : []
  const dueDate = typeof issue?.due_date === 'string' ? issue.due_date.trim() : ''
  const deferUntil = typeof issue?.defer_until === 'string' ? issue.defer_until.trim() : ''
  const sprint = typeof issue?.sprint === 'string' ? issue.sprint.trim() : ''
  const createdBranch = issue?.created_branch ? issue.created_branch.trim() : ''
  const layoutCounts = issue
    ? getTaskDetailLayoutCounts(issue)
    : { overview: 0, activity: 0, details: 0 }

  const resolveConversationSessionId = useCallback(async (tdSessionId: string): Promise<string | null> => {
    if (!issue?.id) return null
    try {
      const params = new URLSearchParams({
        tdSessionId,
        taskId: issue.id,
      })
      if (currentProject?.path) {
        params.set('projectPath', currentProject.path)
      }
      const res = await fetch(`/api/conversations/resolve-linked-session?${params.toString()}`, {
        credentials: 'include',
      })
      if (!res.ok) return null
      const data = (await res.json()) as { sessionId?: string | null }
      return typeof data.sessionId === 'string' ? data.sessionId : null
    } catch {
      return null
    }
  }, [currentProject?.path, issue?.id])

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]',
          'transition-opacity duration-200',
          isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className={cn(
          'fixed inset-y-4 right-4 z-[61] w-full max-w-md bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden',
          'transition-all duration-200 ease-out',
          isVisible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {issue && <StatusIcon className={cn('h-4 w-4 shrink-0', status?.color)} />}
            <span className="font-mono text-sm text-muted-foreground shrink-0">{issueId}</span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !issue ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Task not found</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {/* Title + badges */}
              <div className="space-y-2">
                <h2 className="text-base font-medium leading-snug">{issue.title}</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('text-[11px] rounded-full px-2 py-0.5', status?.bg, status?.color)}>
                    {status?.label}
                  </span>
                  <span className={cn('text-[11px] rounded-full px-2 py-0.5', priority?.color)}>
                    {issue.priority} — {priority?.label}
                  </span>
                  {issue.type !== 'task' && (
                    <span className="flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 bg-purple-500/10 text-purple-400">
                      <Layers className="h-3 w-3" />
                      {issue.type}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 rounded-md border border-border bg-card/40 p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {onStartWorking && issue.status !== 'closed' && issue.status !== 'in_review' && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        onStartWorking(issue.id)
                        handleClose()
                      }}
                    >
                      <Play className="h-3 w-3 mr-1.5" />
                      Start Working
                    </Button>
                  )}
                  {issue.status === 'in_progress' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={actionLoading}
                      onClick={async () => {
                        setActionLoading(true)
                        try {
                          const res = await fetch(`/api/td/issues/${issue.id}/review`, {
                            method: 'POST',
                            credentials: 'include',
                          })
                          if (res.ok) {
                            const data = await fetch(`/api/td/issues/${issue.id}`, { credentials: 'include' }).then(r => r.json())
                            if (data.issue) setIssue(data.issue)
                            onRefresh?.()
                          }
                        } catch { /* silent */ }
                        setActionLoading(false)
                      }}
                    >
                      <Send className="h-3 w-3 mr-1.5" />
                      {actionLoading ? 'Submitting...' : 'Submit for Review'}
                    </Button>
                  )}
                  {issue.status === 'in_review' && (
                    <>
                      {onStartReview && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            onStartReview(issue.id, issue.created_branch || undefined)
                            handleClose()
                          }}
                        >
                          <Play className="h-3 w-3 mr-1.5" />
                          Start Review
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={actionLoading}
                        onClick={async () => {
                          setActionLoading(true)
                          try {
                            const res = await fetch(`/api/td/issues/${issue.id}/approve`, {
                              method: 'POST',
                              credentials: 'include',
                            })
                            if (res.ok) {
                              const data = await fetch(`/api/td/issues/${issue.id}`, { credentials: 'include' }).then(r => r.json())
                              if (data.issue) setIssue(data.issue)
                              onRefresh?.()
                            }
                          } catch { /* silent */ }
                          setActionLoading(false)
                        }}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1.5" />
                        {actionLoading ? 'Approving...' : 'Approve & Close'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={actionLoading}
                        onClick={() => setShowCommentInput(!showCommentInput)}
                      >
                        <RotateCcw className="h-3 w-3 mr-1.5" />
                        Request Changes
                      </Button>
                    </>
                  )}
                </div>

                {/* Request Changes comment input */}
                {showCommentInput && issue.status === 'in_review' && (
                  <div className="space-y-2 rounded border border-border p-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MessageSquare className="h-3 w-3" />
                      <span>Add feedback (optional)</span>
                    </div>
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Describe what needs to change..."
                      className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                      rows={3}
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs"
                        onClick={() => {
                          setShowCommentInput(false)
                          setCommentText('')
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 text-xs"
                        disabled={actionLoading}
                        onClick={async () => {
                          setActionLoading(true)
                          try {
                            const res = await fetch(`/api/td/issues/${issue.id}/request-changes`, {
                              method: 'POST',
                              credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ comment: commentText.trim() || undefined }),
                            })
                            if (res.ok) {
                              const data = await fetch(`/api/td/issues/${issue.id}`, { credentials: 'include' }).then(r => r.json())
                              if (data.issue) setIssue(data.issue)
                              setShowCommentInput(false)
                              setCommentText('')
                              onRefresh?.()
                            }
                          } catch { /* silent */ }
                          setActionLoading(false)
                        }}
                      >
                        {actionLoading ? 'Sending...' : 'Send Back'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TaskDetailTab)}>
                <TabsList className="grid h-8 w-full grid-cols-3">
                  <TabsTrigger value="overview" className="h-6 text-xs px-2">
                    Overview
                    {layoutCounts.overview > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground">({layoutCounts.overview})</span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="activity" className="h-6 text-xs px-2">
                    Activity
                    {layoutCounts.activity > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground">({layoutCounts.activity})</span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="details" className="h-6 text-xs px-2">
                    Details
                    {layoutCounts.details > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground">({layoutCounts.details})</span>
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-2 space-y-2">
                  {issue.description && (
                    <CollapsibleSection title="Description" icon={FileText} defaultOpen>
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {issue.description}
                      </p>
                    </CollapsibleSection>
                  )}

                  {acceptanceCriteria.length > 0 && (
                    <CollapsibleSection title="Acceptance Criteria" icon={CheckCircle2} count={acceptanceCriteria.length} defaultOpen>
                      <ul className="space-y-1">
                        {acceptanceCriteria.map((item, i) => (
                          <li key={`${item}-${i}`} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </CollapsibleSection>
                  )}

                  {children.length > 0 && (
                    <CollapsibleSection title="Subtasks" icon={Layers} count={children.length} defaultOpen>
                      <div className="space-y-3">
                        {(() => {
                          const grouped = groupChildrenByStatus(children)
                          const allChildren = [
                            ...grouped['needs-fix'].map(c => ({ child: c, group: 'needs-fix' as const })),
                            ...grouped['in_review'].map(c => ({ child: c, group: 'in_review' as const })),
                            ...grouped['open'].map(c => ({ child: c, group: 'open' as const })),
                            ...grouped['closed'].map(c => ({ child: c, group: 'closed' as const })),
                          ]
                          return allChildren.map(({ child, group }) => {
                            const childStatus = statusConfig[child.status]
                            const ChildIcon = childStatus?.icon || Circle
                            const isNeedsFix = group === 'needs-fix'
                            const isOpen = group === 'open'
                            const showFixButton = isNeedsFix && onStartWorking
                            const showStartButton = isOpen && onStartWorking && !child.implementer_session

                            return (
                              <div
                                key={child.id}
                                className={cn(
                                  'flex items-center gap-2 rounded px-2 py-1.5',
                                  isNeedsFix && 'bg-orange-500/10 border border-orange-500/30',
                                  !isNeedsFix && 'hover:bg-accent/50'
                                )}
                              >
                                <button
                                  onClick={() => onNavigate?.(child.id)}
                                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                                >
                                  {isNeedsFix && <Wrench className="h-3 w-3 shrink-0 text-orange-400" />}
                                  {!isNeedsFix && <ChildIcon className={cn('h-3 w-3 shrink-0', childStatus?.color)} />}
                                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{child.id}</span>
                                  <span className="text-xs truncate flex-1">{child.title}</span>
                                </button>
                                {showFixButton && (
                                  <Button
                                    size="sm"
                                    className="h-5 text-[10px] px-2 bg-orange-500 hover:bg-orange-600"
                                    onClick={() => {
                                      onStartWorking(child.id)
                                      handleClose()
                                    }}
                                  >
                                    <Wrench className="h-2.5 w-2.5 mr-1" />
                                    Fix
                                  </Button>
                                )}
                                {showStartButton && (
                                  <Button
                                    size="sm"
                                    className="h-5 text-[10px] px-2"
                                    onClick={() => {
                                      onStartWorking(child.id)
                                      handleClose()
                                    }}
                                  >
                                    <Play className="h-2.5 w-2.5 mr-1" />
                                    Start
                                  </Button>
                                )}
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </CollapsibleSection>
                  )}

                  {labels.length > 0 && (
                    <CollapsibleSection title="Labels" icon={Tag} count={labels.length}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {labels.map(label => (
                          <span
                            key={label}
                            className="inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5 bg-muted text-muted-foreground"
                          >
                            <Tag className="h-2.5 w-2.5" />
                            {label}
                          </span>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}
                </TabsContent>

                <TabsContent value="activity" className="mt-2 space-y-2">
                  {linkedSessions.length > 0 && (
                    <CollapsibleSection title="Linked Sessions" icon={MessageSquare} count={linkedSessions.length} defaultOpen>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {linkedSessions.map(linkedSession => (
                          <Button
                            key={linkedSession.id}
                            size="sm"
                            variant="outline"
                            className="h-6 text-[11px] font-mono"
                            onClick={async () => {
                              const resolvedConversationId = await resolveConversationSessionId(linkedSession.id)
                              openConversationView({
                                sessionId: resolvedConversationId || linkedSession.id,
                                taskId: issue.id,
                              })
                              handleClose()
                            }}
                          >
                            {linkedSession.label}: {linkedSession.id}
                          </Button>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}

                  {handoffs.length > 0 && (
                    <CollapsibleSection title="Handoffs" icon={Clock} count={handoffs.length} defaultOpen>
                      <div className="space-y-3">
                        {handoffs.map((handoff, i) => (
                          <div key={handoff.id} className={cn(
                            'rounded border border-border p-3',
                            i === 0 && 'border-primary/30'
                          )}>
                            {i === 0 && (
                              <span className="text-[9px] uppercase tracking-wider text-primary mb-1.5 block">Latest</span>
                            )}
                            <HandoffSection handoff={handoff} nowMs={nowMs} />
                          </div>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}

                  {comments.length > 0 && (
                    <CollapsibleSection title="Comments" icon={MessageSquare} count={comments.length} defaultOpen>
                      <div className="space-y-2">
                        {comments.map(comment => (
                          <article key={comment.id} className="rounded border border-border p-2.5">
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{comment.text}</p>
                            <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                              <RelativeTime timestamp={comment.created_at} nowMs={nowMs} />
                              <span className="font-mono">{comment.session_id}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}

                  {linkedSessions.length === 0 && handoffs.length === 0 && comments.length === 0 && (
                    <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
                      No activity yet.
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="details" className="mt-2 space-y-2">
                  {files.length > 0 && (
                    <CollapsibleSection title="Files" icon={FileText} count={files.length} defaultOpen>
                      <div className="space-y-1">
                        {files.map(file => (
                          <div key={file.id} className="flex items-center gap-2 text-xs">
                            <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="font-mono text-muted-foreground truncate">{file.file_path}</span>
                            {file.role && (
                              <span className="text-[10px] text-muted-foreground/50 shrink-0">{file.role}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}

                  {hasScheduling && (
                    <CollapsibleSection title="Scheduling" icon={Clock} defaultOpen>
                      <div className="grid grid-cols-2 gap-y-1 text-xs">
                        {dueDate && (
                          <>
                            <span className="text-muted-foreground">Due</span>
                            <span>{formatTdDateValue(dueDate)}</span>
                          </>
                        )}
                        {deferUntil && (
                          <>
                            <span className="text-muted-foreground">Deferred Until</span>
                            <span>{formatTdDateValue(deferUntil)}</span>
                          </>
                        )}
                        {issue.points > 0 && (
                          <>
                            <span className="text-muted-foreground">Points</span>
                            <span>{issue.points}</span>
                          </>
                        )}
                        {sprint && (
                          <>
                            <span className="text-muted-foreground">Sprint</span>
                            <span>{sprint}</span>
                          </>
                        )}
                        {issue.minor === 1 && (
                          <>
                            <span className="text-muted-foreground">Minor</span>
                            <span>Yes</span>
                          </>
                        )}
                        {issue.defer_count > 0 && (
                          <>
                            <span className="text-muted-foreground">Defer Count</span>
                            <span>{issue.defer_count}</span>
                          </>
                        )}
                        {createdBranch && (
                          <>
                            <span className="text-muted-foreground">Branch</span>
                            <span className="font-mono">{createdBranch}</span>
                          </>
                        )}
                      </div>
                    </CollapsibleSection>
                  )}

                  <CollapsibleSection title="Metadata" icon={Clock} defaultOpen>
                    <div className="grid grid-cols-2 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Created</span>
                      <RelativeTime timestamp={issue.created_at} nowMs={nowMs} />
                      <span className="text-muted-foreground">Updated</span>
                      <RelativeTime timestamp={issue.updated_at} nowMs={nowMs} />
                      {issue.closed_at && (
                        <>
                          <span className="text-muted-foreground">Closed</span>
                          <RelativeTime timestamp={issue.closed_at} nowMs={nowMs} />
                        </>
                      )}
                      <span className="text-muted-foreground">Parent ID</span>
                      <span className="font-mono">{issue.parent_id || '—'}</span>
                      <span className="text-muted-foreground">Creator Session</span>
                      <span className="font-mono">{issue.creator_session || '—'}</span>
                      <span className="text-muted-foreground">Defer Count</span>
                      <span>{issue.defer_count}</span>
                    </div>
                  </CollapsibleSection>
                </TabsContent>
              </Tabs>
            </div>
          </ScrollArea>
        )}
      </div>
    </>
  )
}
