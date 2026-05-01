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
}: {
  issue: TdIssue
  dimmed: boolean
}) {
  // Click is handled by ReactFlow's onNodeClick at the wrapper level — see
  // notes on TaskGraphView's <ReactFlow onNodeClick> prop. An inner <button>
  // would block events when the wrapper's pointer-events resolves to none
  // (which happens when neither selectable nor onNodeClick are active).
  return (
    <div
      className={cn(
        'relative rounded border-2 bg-card p-2 text-left transition-opacity cursor-pointer hover:bg-accent/50',
        statusBorderClass(issue.status),
        dimmed && 'opacity-30',
      )}
      style={{ width: NODE_DIMENSIONS.width, height: NODE_DIMENSIONS.height }}
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <div className="flex flex-col gap-1.5 h-full">
        <p className="text-sm leading-snug line-clamp-2 flex-1">{issue.title}</p>
        <div className="flex items-center justify-between gap-1">
          <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', priorityBadgeClass(issue.priority))}>
            {issue.priority}
          </span>
          <span className="text-xs font-mono text-muted-foreground shrink-0">{issue.id}</span>
        </div>
      </div>
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
  const { tdDepsByProject, fetchTdDeps } = useAppStore()
  const deps = tdDepsByProject[projectPath] ?? []
  const [loaded, setLoaded] = useState(false)

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

  const { nodes: rawNodes, edges: rawEdges } = useMemo(
    () => buildGraph(issues, deps),
    [issues, deps],
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
          data: { issue: n.data.issue, dimmed },
          // Pre-supply measurements so react-flow can render edges immediately
          // on first paint instead of waiting for ResizeObserver — the dimensions
          // come from buildGraph which already fed them to dagre for layout.
          width: n.width,
          height: n.height,
          measured: { width: n.width, height: n.height },
          draggable: false,
          // NOTE: do NOT set `selectable: false` here. react-flow computes
          // hasPointerEvents = isSelectable || isDraggable || onNodeClick.
          // With everything off, the node wrapper gets pointer-events:none
          // and clicks never reach our handler. We pass onNodeClick at the
          // <ReactFlow> level which both sets the handler AND keeps pointer
          // events alive without enabling the visual selection ring.
        }
      }),
    [rawNodes, highlighted],
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
      issue: ({ data }: { data: { issue: TdIssue; dimmed: boolean } }) => (
        <IssueNodeCard issue={data.issue} dimmed={data.dimmed} />
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
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground p-8">
        <p className="text-sm">No tasks to display.</p>
      </div>
    )
  }

  return (
    <div className="relative flex-1 min-h-0">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        colorMode="dark"
        onNodeClick={(_, node) => onSelect(node.id)}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
