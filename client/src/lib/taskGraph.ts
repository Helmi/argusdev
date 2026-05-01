import dagre from '@dagrejs/dagre'
import type { TdIssue, TdIssueDependency } from './types'

export interface GraphNodeData {
  issue: TdIssue
}

export interface GraphNode {
  id: string
  data: GraphNodeData
  position: { x: number; y: number }
  // react-flow expects these but we set them at the consumer to keep this pure.
  width: number
  height: number
}

export type GraphEdgeKind = 'parent' | 'dep'

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: GraphEdgeKind
}

export interface BuildGraphResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface BuildGraphOptions {
  hideClosedComponents?: boolean
}

const NODE_WIDTH = 220
const NODE_HEIGHT = 80

/**
 * Build the graph (nodes + edges) from issues and deps.
 *
 * Stability requirement: same input data → same layout. Dagre's output depends
 * on insertion order, so we sort nodes by id and edges by (source, target)
 * before feeding the layout engine.
 *
 * Edges:
 *  - parent → child  (from issue.parent_id, only if parent is in the visible set)
 *  - depends_on      (from TdIssueDependency rows; edge points prerequisite → dependent
 *                     so the prerequisite lays out above its dependent under TB rankdir)
 */
export function buildGraph(
  issues: TdIssue[],
  deps: TdIssueDependency[],
  options: BuildGraphOptions = {},
): BuildGraphResult {
  const { hideClosedComponents = true } = options

  // Filter out soft-deleted issues
  const visible = issues.filter(i => !i.deleted_at)
  const visibleIds = new Set(visible.map(i => i.id))

  // Stable input ordering
  const sortedIssues = [...visible].sort((a, b) => a.id.localeCompare(b.id))

  // Parent edges: only include when parent is also visible
  const parentEdges: GraphEdge[] = []
  for (const issue of sortedIssues) {
    if (issue.parent_id && visibleIds.has(issue.parent_id)) {
      parentEdges.push({
        id: `parent:${issue.parent_id}->${issue.id}`,
        source: issue.parent_id,
        target: issue.id,
        kind: 'parent',
      })
    }
  }

  // Dep edges: only include when both endpoints are visible.
  //
  // Direction choice: source = prerequisite (depends_on_id), target = dependent (issue_id).
  // With rankdir: 'TB' this places the prerequisite ABOVE the dependent — matching the
  // parent-edge convention that "above = upstream / what others wait on". The arrow
  // points downward from the prerequisite to the dependent that needs it.
  const depEdges: GraphEdge[] = []
  for (const dep of deps) {
    if (dep.relation_type !== 'depends_on') continue
    if (!visibleIds.has(dep.issue_id) || !visibleIds.has(dep.depends_on_id)) continue
    depEdges.push({
      id: `dep:${dep.id}`,
      source: dep.depends_on_id,
      target: dep.issue_id,
      kind: 'dep',
    })
  }

  const allEdges = [...parentEdges, ...depEdges].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source)
    if (a.target !== b.target) return a.target.localeCompare(b.target)
    return a.id.localeCompare(b.id)
  })

  // Optionally drop connected components where every node is closed.
  // Build undirected adjacency, DFS to find components, filter all-closed ones.
  let layoutIssues = sortedIssues
  let layoutEdges = allEdges

  if (hideClosedComponents) {
    const adj = new Map<string, Set<string>>()
    for (const issue of sortedIssues) {
      if (!adj.has(issue.id)) adj.set(issue.id, new Set())
    }
    for (const edge of allEdges) {
      adj.get(edge.source)!.add(edge.target)
      adj.get(edge.target)!.add(edge.source)
    }

    const visited = new Set<string>()
    const hiddenIds = new Set<string>()

    for (const issue of sortedIssues) {
      if (visited.has(issue.id)) continue

      // DFS to collect the connected component
      const component: TdIssue[] = []
      const stack = [issue.id]
      while (stack.length > 0) {
        const id = stack.pop()!
        if (visited.has(id)) continue
        visited.add(id)
        const found = sortedIssues.find(i => i.id === id)
        if (found) component.push(found)
        for (const neighbor of adj.get(id) ?? []) {
          if (!visited.has(neighbor)) stack.push(neighbor)
        }
      }

      if (component.every(i => i.status === 'closed')) {
        for (const i of component) hiddenIds.add(i.id)
      }
    }

    layoutIssues = sortedIssues.filter(i => !hiddenIds.has(i.id))
    layoutEdges = allEdges.filter(e => !hiddenIds.has(e.source) && !hiddenIds.has(e.target))
  }

  // Run dagre layout
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 })

  for (const issue of layoutIssues) {
    g.setNode(issue.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of layoutEdges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const nodes: GraphNode[] = layoutIssues.map(issue => {
    const pos = g.node(issue.id)
    return {
      id: issue.id,
      data: { issue },
      // dagre returns the center; react-flow expects top-left
      position: pos
        ? { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 }
        : { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }
  })

  return { nodes, edges: layoutEdges }
}

/**
 * Given a search query, return the set of node ids that should be highlighted
 * (full opacity). Highlighted = matching node OR direct neighbor of a match.
 *
 * If the query is empty, returns null (caller should treat as "highlight all").
 */
export function computeHighlighted(
  nodes: GraphNode[],
  edges: GraphEdge[],
  query: string,
): Set<string> | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  const matched = new Set<string>()
  for (const node of nodes) {
    const issue = node.data.issue
    const haystack = [issue.id, issue.title, issue.labels ?? '', issue.description ?? '']
      .join(' ')
      .toLowerCase()
    if (haystack.includes(q)) matched.add(node.id)
  }

  if (matched.size === 0) return matched

  // Expand by direct neighbors (both directions)
  const result = new Set(matched)
  for (const edge of edges) {
    if (matched.has(edge.source)) result.add(edge.target)
    if (matched.has(edge.target)) result.add(edge.source)
  }
  return result
}

export const NODE_DIMENSIONS = { width: NODE_WIDTH, height: NODE_HEIGHT }
