import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Edge as RFEdge,
  type Node as RFNode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useAppStore } from '@/lib/store'
import type { TdIssue } from '@/lib/types'
import { buildGraph, computeHighlighted, NODE_DIMENSIONS } from '@/lib/taskGraph'
import { cn } from '@/lib/utils'
import { LIGHT_THEMES } from '@/lib/iconConfig'
import { Loader2 } from 'lucide-react'

// Status → border color, kept in sync with STATUS_COLUMNS in TaskBoard.tsx
function statusBorderClass(status: string): string {
  if (status === 'in_progress') return 'border-blue-500'
  if (status === 'in_review') return 'border-purple-500'
  if (status === 'blocked') return 'border-red-500'
  if (status === 'closed') return 'border-green-500'
  return 'border-border'
}

function priorityBadgeClass(priority: string): string {
  if (priority === 'P0') return 'bg-red-500/15 text-red-400'
  if (priority === 'P1') return 'bg-orange-500/15 text-orange-400'
  return 'bg-muted text-muted-foreground'
}

// Invisible handles — required by @xyflow/react v12 for custom nodes to attach edges.
// Without these, edges fail with "Couldn't create edge for source handle id: null".
const HANDLE_STYLE: React.CSSProperties = {
  width: 1,
  height: 1,
  background: 'transparent',
  border: 'none',
  pointerEvents: 'none',
}

function IssueNodeCard({
  issue,
  dimmed,
  onSelect,
}: {
  issue: TdIssue
  dimmed: boolean
  onSelect: (id: string) => void
}) {
  // Native <button> restores keyboard a11y (Tab/Enter/Space) and screen-reader
  // semantics. Pointer events stay alive because each node carries
  // selectable:true at the data level, which makes react-flow's NodeWrapper
  // set pointer-events:all on the node container. We stop propagation so
  // react-flow's own click handler doesn't double-fire alongside ours.
  return (
    <div
      className="relative"
      style={{ width: NODE_DIMENSIONS.width, height: NODE_DIMENSIONS.height }}
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          onSelect(issue.id)
        }}
        className={cn(
          'w-full h-full rounded border-2 bg-card p-2 text-left transition-opacity hover:bg-accent/50',
          statusBorderClass(issue.status),
          dimmed && 'opacity-30',
        )}
      >
        <div className="flex flex-col gap-1.5 h-full">
          <p className="text-sm leading-snug line-clamp-2 flex-1">{issue.title}</p>
          <div className="flex items-center justify-between gap-1">
            <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', priorityBadgeClass(issue.priority))}>
              {issue.priority}
            </span>
            <span className="text-xs font-mono text-muted-foreground shrink-0">{issue.id}</span>
          </div>
        </div>
      </button>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} isConnectable={false} />
    </div>
  )
}

interface TaskGraphViewProps {
  projectPath: string
  issues: TdIssue[]
  searchQuery: string
  onSelect: (id: string) => void
}

export default function TaskGraphView({
  projectPath,
  issues,
  searchQuery,
  onSelect,
}: TaskGraphViewProps) {
  const { tdDepsByProject, fetchTdDeps, theme, graphHideClosedComponents, setGraphHideClosedComponents } = useAppStore()
  const deps = tdDepsByProject[projectPath] ?? []
  const [loaded, setLoaded] = useState(false)
  // Drive react-flow's CSS variables off argusdev's theme. Hardcoding
  // 'dark' would leave the controls white-on-light on themes like
  // 'github' or 'solarized-light'; hardcoding 'light' would lose the
  // original fix for argusdev's default dark theme.
  const colorMode: 'light' | 'dark' = LIGHT_THEMES.includes(
    theme as (typeof LIGHT_THEMES)[number],
  )
    ? 'light'
    : 'dark'

  // Lazy fetch of deps on first mount per project
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    fetchTdDeps(projectPath).finally(() => {
      if (!cancelled) setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [projectPath, fetchTdDeps])

  const visibleIssueCount = useMemo(() => issues.filter(i => !i.deleted_at).length, [issues])

  const { nodes: rawNodes, edges: rawEdges } = useMemo(
    () => buildGraph(issues, deps, { hideClosedComponents: graphHideClosedComponents }),
    [issues, deps, graphHideClosedComponents],
  )

  const highlighted = useMemo(
    () => computeHighlighted(rawNodes, rawEdges, searchQuery),
    [rawNodes, rawEdges, searchQuery],
  )

  const flowNodes: RFNode[] = useMemo(
    () =>
      rawNodes.map(n => {
        const dimmed = highlighted !== null && !highlighted.has(n.id)
        return {
          id: n.id,
          type: 'issue',
          position: n.position,
          data: { issue: n.data.issue, dimmed, onSelect },
          // Pre-supply measurements so react-flow can render edges immediately
          // on first paint instead of waiting for ResizeObserver — the dimensions
          // come from buildGraph which already fed them to dagre for layout.
          width: n.width,
          height: n.height,
          measured: { width: n.width, height: n.height },
          draggable: false,
          // selectable:true keeps the node wrapper's pointer-events:all so
          // the inner <button> receives clicks and keyboard input. We pair
          // this with elementsSelectable={false} on the ReactFlow root,
          // which suppresses the visual selection ring while preserving
          // event flow.
          selectable: true,
        }
      }),
    [rawNodes, highlighted, onSelect],
  )

  const flowEdges: RFEdge[] = useMemo(
    () =>
      rawEdges.map(e => {
        const dimmed =
          highlighted !== null && !(highlighted.has(e.source) && highlighted.has(e.target))
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          animated: false,
          style: {
            stroke: e.kind === 'parent' ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
            strokeWidth: 1.5,
            strokeDasharray: e.kind === 'dep' ? '6 4' : undefined,
            opacity: dimmed ? 0.2 : 0.8,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: e.kind === 'parent' ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))',
          },
        }
      }),
    [rawEdges, highlighted],
  )

  const nodeTypes = useMemo(
    () => ({
      issue: ({
        data,
      }: {
        data: { issue: TdIssue; dimmed: boolean; onSelect: (id: string) => void }
      }) => (
        <IssueNodeCard issue={data.issue} dimmed={data.dimmed} onSelect={data.onSelect} />
      ),
    }),
    [],
  )

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading graph…</span>
      </div>
    )
  }

  if (rawNodes.length === 0) {
    const filteredByClosed = graphHideClosedComponents && visibleIssueCount > 0
    return (
      <div className="flex flex-col flex-1 items-center justify-center text-muted-foreground p-8 gap-3">
        <p className="text-sm">{filteredByClosed ? 'All tasks are closed.' : 'No tasks to display.'}</p>
        {filteredByClosed && (
          <button
            type="button"
            onClick={() => setGraphHideClosedComponents(false)}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-accent/50 transition-colors"
          >
            Show all tasks
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div className="absolute top-2 right-2 z-10">
        <button
          type="button"
          onClick={() => setGraphHideClosedComponents(!graphHideClosedComponents)}
          className={cn(
            'text-xs px-2 py-1 rounded border transition-colors',
            graphHideClosedComponents
              ? 'border-border bg-background text-muted-foreground hover:bg-accent/50'
              : 'border-border bg-accent text-foreground hover:bg-accent/70',
          )}
        >
          {graphHideClosedComponents ? 'Active only' : 'Show all'}
        </button>
      </div>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        colorMode={colorMode}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
