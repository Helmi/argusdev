import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAppStore } from '@/lib/store'
import type { TdIssue } from '@/lib/types'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { TaskDetailModal } from '@/components/TaskDetailModal'
import {
  ListTodo,
  LayoutGrid,
  List,
  Search,
  X,
  Circle,
  CircleDot,
  CheckCircle2,
  PauseCircle,
  AlertCircle,
  Layers,
  FolderGit2,
  RefreshCw,
  XCircle,
} from 'lucide-react'

// Status column configuration
const STATUS_COLUMNS = [
  { key: 'open', label: 'Open', icon: Circle, color: 'text-muted-foreground', bg: 'bg-muted/30' },
  { key: 'in_progress', label: 'In Progress', icon: CircleDot, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { key: 'in_review', label: 'In Review', icon: PauseCircle, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  { key: 'blocked', label: 'Blocked', icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
  { key: 'closed', label: 'Closed', icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/10' },
]

type ViewMode = 'board' | 'list'

function priorityBadgeClass(priority: string): string {
  if (priority === 'P0') return 'bg-red-500/15 text-red-400'
  if (priority === 'P1') return 'bg-orange-500/15 text-orange-400'
  if (priority === 'P2') return 'bg-muted text-muted-foreground'
  return 'bg-muted text-muted-foreground'
}

function IssueCard({ issue, compact, indent, onSelect, childCount }: { issue: TdIssue; compact?: boolean; indent?: boolean; onSelect: (id: string) => void; childCount?: number }) {
  return (
    <button
      onClick={() => onSelect(issue.id)}
      className={cn(
        'w-full text-left rounded border border-border/50 bg-card p-2.5 transition-colors',
        'hover:bg-accent/50 hover:border-border',
        compact && 'p-2',
        indent && 'ml-4',
      )}
    >
      <div className="flex flex-col gap-2">
        {/* Title — full width */}
        <p className="text-sm leading-snug line-clamp-2">
          {issue.title}
        </p>
        {/* Bottom row */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            {/* Priority badge */}
            <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', priorityBadgeClass(issue.priority))}>
              {issue.priority}
            </span>
            {/* Epic child count */}
            {issue.type === 'epic' && (
              <div className="flex items-center gap-0.5">
                <Layers className="h-3 w-3 text-purple-400" />
                {childCount != null && childCount > 0 && (
                  <span className="text-xs text-muted-foreground">{childCount}</span>
                )}
              </div>
            )}
          </div>
          {/* Task ID */}
          <span className="text-xs font-mono text-muted-foreground shrink-0">
            {issue.id}
          </span>
        </div>
      </div>
    </button>
  )
}

/** Group issues: epics first with their children nested underneath, then orphan tasks */
function groupIssuesWithChildren(issues: TdIssue[]): Array<{ issue: TdIssue; children: TdIssue[] }> {
  const epicIds = new Set(issues.filter(i => i.type === 'epic').map(i => i.id))
  const childrenByParent = new Map<string, TdIssue[]>()
  const orphans: TdIssue[] = []

  for (const issue of issues) {
    if (issue.type === 'epic') continue
    if (issue.parent_id && epicIds.has(issue.parent_id)) {
      const arr = childrenByParent.get(issue.parent_id) || []
      arr.push(issue)
      childrenByParent.set(issue.parent_id, arr)
    } else {
      orphans.push(issue)
    }
  }

  const result: Array<{ issue: TdIssue; children: TdIssue[] }> = []
  // Epics with their children
  for (const issue of issues) {
    if (issue.type === 'epic') {
      result.push({ issue, children: childrenByParent.get(issue.id) || [] })
    }
  }
  // Orphan tasks (no parent or parent not in this column)
  for (const issue of orphans) {
    result.push({ issue, children: [] })
  }

  return result
}

function StatusColumn({ status, issues, onSelect, childCountByEpicId }: {
  status: typeof STATUS_COLUMNS[0]
  issues: TdIssue[]
  onSelect: (id: string) => void
  childCountByEpicId: Map<string, number>
}) {
  const StatusIcon = status.icon
  const [showAllClosed, setShowAllClosed] = useState(false)

  // Collapse only when empty — no manual toggle, derived purely from data
  const isCollapsed = issues.length === 0

  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const visibleIssues = (status.key === 'closed' && !showAllClosed)
    ? issues.filter(i => (i.closed_at ?? '') >= threeDaysAgo)
    : issues
  const hiddenClosedCount = issues.length - visibleIssues.length

  if (isCollapsed) {
    return (
      <div
        className="flex flex-col items-center gap-1.5 py-2 px-1 rounded border border-border/30 bg-muted/10 w-10 shrink-0"
        title={`${status.label} (0)`}
      >
        <StatusIcon className={cn('h-3.5 w-3.5', status.color)} />
        <span className="text-xs text-muted-foreground font-medium">{issues.length}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-w-[220px] max-w-[480px]">
      <div className={cn('flex items-center gap-1.5 px-2 py-2 rounded-t', status.bg)}>
        <StatusIcon className={cn('h-3.5 w-3.5', status.color)} />
        <span className="text-sm font-medium">{status.label}</span>
        <span className="text-xs text-muted-foreground ml-auto">{issues.length}</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-2 p-2">
          {visibleIssues.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onSelect={onSelect}
              childCount={issue.type === 'epic' ? childCountByEpicId.get(issue.id) : undefined}
            />
          ))}
          {status.key === 'closed' && hiddenClosedCount > 0 && (
            <button
              onClick={() => setShowAllClosed(true)}
              className="w-full text-xs text-muted-foreground hover:text-foreground py-2 text-center border border-border/30 rounded"
            >
              Show {hiddenClosedCount} older
            </button>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export function TaskBoard() {
  const {
    tdBoardView,
    fetchTdBoard,
    fetchTdIssues,
    tdIssues,
    openAddSession,
    closeTaskBoard,
    taskBoardOpen,
    taskBoardProjectPath,
    projects,
  } = useAppStore()

  const taskBoardProject = projects.find(p => p.path === taskBoardProjectPath) ?? null
  const [viewMode, setViewMode] = useState<ViewMode>('board')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)

  const childCountByEpicId = useMemo(() => {
    const counts = new Map<string, number>()
    tdIssues.forEach(issue => {
      if (issue.parent_id && issue.status !== 'closed') {
        counts.set(issue.parent_id, (counts.get(issue.parent_id) ?? 0) + 1)
      }
    })
    return counts
  }, [tdIssues])

  // Fetch board data whenever the board opens or the project changes.
  // Fetch unconditionally when board opens — tdEnabled is checked at render time.
  useEffect(() => {
    if (taskBoardOpen && taskBoardProjectPath) {
      fetchTdBoard(taskBoardProjectPath)
      fetchTdIssues({ projectPath: taskBoardProjectPath })
    }
  }, [taskBoardOpen, taskBoardProjectPath, fetchTdBoard, fetchTdIssues])

  // Escape key handler to close task board
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeTaskBoard()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeTaskBoard])

  // Client-side filter for issues
  const filterIssues = useCallback((issues: TdIssue[]) => {
    if (!searchQuery.trim()) return issues
    const q = searchQuery.toLowerCase()
    return issues.filter(i =>
      i.title.toLowerCase().includes(q) ||
      i.id.toLowerCase().includes(q) ||
      i.labels?.toLowerCase().includes(q) ||
      i.description?.toLowerCase().includes(q)
    )
  }, [searchQuery])

  // Filtered board view (for kanban)
  const filteredBoard = useMemo(() => {
    if (!searchQuery.trim()) return tdBoardView
    const filtered: Record<string, TdIssue[]> = {}
    for (const [status, issues] of Object.entries(tdBoardView)) {
      filtered[status] = filterIssues(issues)
    }
    return filtered
  }, [tdBoardView, searchQuery, filterIssues])

  if (!taskBoardProject?.tdEnabled) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-8">
        <ListTodo className="h-8 w-8 opacity-30" />
        <p className="text-sm">TD not enabled for this project</p>
        <p className="text-xs opacity-60">Install td and initialize a .todos/ database to use task management</p>
      </div>
    )
  }

  const displayIssues = filterIssues(tdIssues)
  const groupedList = groupIssuesWithChildren(displayIssues)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border shrink-0">
        {/* View toggle + refresh */}
        <div className="flex items-center gap-1 bg-muted rounded p-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-6 w-6', viewMode === 'board' && 'bg-background shadow-sm')}
            onClick={() => setViewMode('board')}
            title="Board view"
          >
            <LayoutGrid className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-6 w-6', viewMode === 'list' && 'bg-background shadow-sm')}
            onClick={() => setViewMode('list')}
            title="List view"
          >
            <List className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => { if (taskBoardProjectPath) { fetchTdBoard(taskBoardProjectPath); fetchTdIssues({ projectPath: taskBoardProjectPath }) } }}
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>

        {/* Search */}
        <div className="flex-1 flex items-center gap-1.5">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter tasks..."
            className="h-6 text-xs border-0 bg-transparent shadow-none focus-visible:ring-0 px-0"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setSearchQuery('')}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Project indicator */}
        {taskBoardProject && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <FolderGit2 className="h-3 w-3" />
            <span className="font-medium truncate max-w-[120px]">{taskBoardProject.name}</span>
          </div>
        )}

        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={closeTaskBoard}
          title="Close task board (Esc)"
        >
          <XCircle className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Board View */}
      {viewMode === 'board' ? (
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-2 p-2 h-full">
            {STATUS_COLUMNS.map(status => (
              <StatusColumn
                key={status.key}
                status={status}
                issues={(filteredBoard[status.key] || []).filter(i => !i.deleted_at)}
                onSelect={setSelectedIssueId}
                childCountByEpicId={childCountByEpicId}
              />
            ))}
          </div>
        </div>
      ) : (
        /* List View */
        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            {displayIssues.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                {searchQuery ? 'No matching tasks' : 'No tasks found'}
              </p>
            ) : (
              groupedList.map(({ issue, children }) => (
                <div key={issue.id}>
                  <IssueCard
                    issue={issue}
                    compact
                    onSelect={setSelectedIssueId}
                    childCount={issue.type === 'epic' ? childCountByEpicId.get(issue.id) : undefined}
                  />
                  {children.map(child => (
                    <div key={child.id} className="mt-1">
                      <IssueCard
                        issue={child}
                        compact
                        indent
                        onSelect={setSelectedIssueId}
                      />
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      )}

      {/* Task Detail Modal */}
      {selectedIssueId && (
        <TaskDetailModal
          issueId={selectedIssueId}
          onClose={() => setSelectedIssueId(null)}
          onNavigate={setSelectedIssueId}
          onStartWorking={(taskId, intent = 'work') => {
            const issue = tdIssues.find(i => i.id === taskId)
            closeTaskBoard()
            openAddSession(undefined, taskBoardProjectPath ?? undefined, taskId, {
              intent: intent || 'work',
              createdBranch: issue?.created_branch || undefined,
            })
          }}
          onStartReview={(taskId, createdBranch) => {
            const issue = tdIssues.find(i => i.id === taskId)
            closeTaskBoard()
            openAddSession(undefined, taskBoardProjectPath ?? undefined, taskId, {
              intent: 'review',
              sessionName: `Review: ${taskId}`,
              createdBranch: issue?.created_branch || createdBranch,
            })
          }}
          onRefresh={() => { if (taskBoardProjectPath) { fetchTdBoard(taskBoardProjectPath); fetchTdIssues({ projectPath: taskBoardProjectPath }) } }}
        />
      )}
    </div>
  )
}
