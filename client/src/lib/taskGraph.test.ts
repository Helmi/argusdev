import { describe, it, expect } from 'vitest'
import { buildGraph, computeHighlighted } from './taskGraph'
import type { TdIssue, TdIssueDependency } from './types'

function issue(partial: Partial<TdIssue> & { id: string; title: string }): TdIssue {
  return {
    description: '',
    status: 'open',
    type: 'task',
    priority: 'P2',
    points: 0,
    labels: '',
    parent_id: '',
    acceptance: '',
    implementer_session: '',
    reviewer_session: '',
    created_at: '',
    updated_at: '',
    closed_at: null,
    deleted_at: null,
    minor: 0,
    created_branch: '',
    creator_session: '',
    sprint: '',
    defer_until: null,
    due_date: null,
    defer_count: 0,
    ...partial,
  }
}

function dep(id: string, from: string, to: string): TdIssueDependency {
  return { id, issue_id: from, depends_on_id: to, relation_type: 'depends_on' }
}

describe('buildGraph', () => {
  it('builds nodes for every visible issue', () => {
    const issues = [
      issue({ id: 'td-001', title: 'Epic', type: 'epic' }),
      issue({ id: 'td-002', title: 'Child A', parent_id: 'td-001' }),
      issue({ id: 'td-003', title: 'Child B', parent_id: 'td-001' }),
    ]
    const { nodes } = buildGraph(issues, [])
    expect(nodes.map(n => n.id).sort()).toEqual(['td-001', 'td-002', 'td-003'])
    nodes.forEach(n => {
      expect(typeof n.position.x).toBe('number')
      expect(typeof n.position.y).toBe('number')
    })
  })

  it('emits parent edges for parent_id when parent is in the visible set', () => {
    const issues = [
      issue({ id: 'td-001', title: 'Epic', type: 'epic' }),
      issue({ id: 'td-002', title: 'Child', parent_id: 'td-001' }),
    ]
    const { edges } = buildGraph(issues, [])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 'td-001', target: 'td-002', kind: 'parent' })
  })

  it('drops parent edges when parent is not in the visible set', () => {
    const issues = [issue({ id: 'td-002', title: 'Orphan', parent_id: 'td-missing' })]
    const { edges } = buildGraph(issues, [])
    expect(edges).toEqual([])
  })

  it('emits dep edges from issue_dependencies when both endpoints are visible', () => {
    const issues = [
      issue({ id: 'td-a', title: 'A' }),
      issue({ id: 'td-b', title: 'B' }),
    ]
    const deps = [dep('d1', 'td-a', 'td-b')]
    const { edges } = buildGraph(issues, deps)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 'td-a', target: 'td-b', kind: 'dep' })
  })

  it('drops dep edges when one endpoint is missing', () => {
    const issues = [issue({ id: 'td-a', title: 'A' })]
    const deps = [dep('d1', 'td-a', 'td-missing')]
    const { edges } = buildGraph(issues, deps)
    expect(edges).toEqual([])
  })

  it('ignores deps with relation_type other than depends_on', () => {
    const issues = [
      issue({ id: 'td-a', title: 'A' }),
      issue({ id: 'td-b', title: 'B' }),
    ]
    const deps = [{ ...dep('d1', 'td-a', 'td-b'), relation_type: 'related_to' }]
    const { edges } = buildGraph(issues, deps)
    expect(edges).toEqual([])
  })

  it('excludes soft-deleted issues from nodes and edges', () => {
    const issues = [
      issue({ id: 'td-a', title: 'A' }),
      issue({ id: 'td-b', title: 'B', deleted_at: '2026-01-01' }),
    ]
    const deps = [dep('d1', 'td-a', 'td-b')]
    const { nodes, edges } = buildGraph(issues, deps)
    expect(nodes.map(n => n.id)).toEqual(['td-a'])
    expect(edges).toEqual([])
  })

  it('produces a stable layout for the same data regardless of input order', () => {
    const a = issue({ id: 'td-001', title: 'Epic', type: 'epic' })
    const b = issue({ id: 'td-002', title: 'Child A', parent_id: 'td-001' })
    const c = issue({ id: 'td-003', title: 'Child B', parent_id: 'td-001' })
    const deps = [dep('d2', 'td-002', 'td-003'), dep('d1', 'td-003', 'td-002')]

    const r1 = buildGraph([a, b, c], deps)
    const r2 = buildGraph([c, b, a], [...deps].reverse())

    const positionsById = (r: ReturnType<typeof buildGraph>) =>
      Object.fromEntries(r.nodes.map(n => [n.id, n.position]))

    expect(positionsById(r1)).toEqual(positionsById(r2))
    expect(r1.edges.map(e => e.id)).toEqual(r2.edges.map(e => e.id))
  })
})

describe('computeHighlighted', () => {
  const issues = [
    issue({ id: 'td-001', title: 'Epic', type: 'epic' }),
    issue({ id: 'td-002', title: 'Login page', parent_id: 'td-001' }),
    issue({ id: 'td-003', title: 'Logout button', parent_id: 'td-001' }),
    issue({ id: 'td-004', title: 'Unrelated work' }),
  ]
  const { nodes, edges } = buildGraph(issues, [])

  it('returns null for empty query', () => {
    expect(computeHighlighted(nodes, edges, '')).toBeNull()
    expect(computeHighlighted(nodes, edges, '   ')).toBeNull()
  })

  it('matches by title and includes direct neighbors', () => {
    const result = computeHighlighted(nodes, edges, 'login')
    expect(result).not.toBeNull()
    // Login matches td-002, neighbor via parent edge is td-001
    expect(result!.has('td-002')).toBe(true)
    expect(result!.has('td-001')).toBe(true)
    expect(result!.has('td-004')).toBe(false)
  })

  it('matches by id', () => {
    const result = computeHighlighted(nodes, edges, 'td-004')
    expect(result!.has('td-004')).toBe(true)
    expect(result!.has('td-001')).toBe(false)
  })

  it('returns empty set when nothing matches', () => {
    const result = computeHighlighted(nodes, edges, 'zzz-no-such-thing')
    expect(result).not.toBeNull()
    expect(result!.size).toBe(0)
  })
})
