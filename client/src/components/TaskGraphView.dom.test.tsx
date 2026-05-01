import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import type { TdIssue, TdIssueDependency } from '../lib/types'

// --- Mocks required for @xyflow/react to render in jsdom ---
//
// react-flow uses ResizeObserver and DOMMatrix to measure the canvas. jsdom
// implements neither. Without these mocks the component throws during mount.

beforeAll(() => {
  // @xyflow/react uses ResizeObserver to detect node sizes — without a callback
  // that delivers a non-zero contentRect, nodes stay hidden and no edges are
  // drawn. Fire one immediately on observe() with the node's CSS-declared size.
  class ResizeObserverMock {
    private cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(target: Element) {
      const rect: DOMRectReadOnly = {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 220,
        bottom: 80,
        width: 220,
        height: 80,
        toJSON() {
          return this
        },
      }
      this.cb(
        [
          {
            target,
            contentRect: rect,
            borderBoxSize: [{inlineSize: 220, blockSize: 80}],
            contentBoxSize: [{inlineSize: 220, blockSize: 80}],
            devicePixelContentBoxSize: [{inlineSize: 220, blockSize: 80}],
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      )
    }
    unobserve() {}
    disconnect() {}
  }
  ;(global as unknown as {ResizeObserver: unknown}).ResizeObserver = ResizeObserverMock
  ;(global as unknown as {DOMMatrixReadOnly: unknown}).DOMMatrixReadOnly = class {
    m22 = 1
    constructor(_t?: string) {}
  }

  // jsdom returns 0/0 for getBoundingClientRect — react-flow needs non-zero
  // viewport dimensions to lay out nodes and edges.
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON() {
        return this
      },
    } as DOMRect
  }

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    value: 600,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    value: 800,
  })

  if (typeof window !== 'undefined' && !window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
      window.setTimeout(() => cb(performance.now()), 0)
    window.cancelAnimationFrame = (id: number) => window.clearTimeout(id)
  }
})

function makeIssue(partial: Partial<TdIssue> & { id: string; title: string }): TdIssue {
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

const MOCK_ISSUES: TdIssue[] = [
  makeIssue({ id: 'td-aaa', title: 'Parent epic', type: 'epic' }),
  makeIssue({ id: 'td-bbb', title: 'Child task', parent_id: 'td-aaa' }),
  makeIssue({ id: 'td-ccc', title: 'Dependent task' }),
]

const MOCK_DEPS: TdIssueDependency[] = [
  // td-ccc depends on td-bbb → edge prerequisite (td-bbb) → dependent (td-ccc)
  { id: 'dep-1', issue_id: 'td-ccc', depends_on_id: 'td-bbb', relation_type: 'depends_on' },
]

// Mock the store hook so we don't need the full AppProvider tree.
//
// CRITICAL: hoist the store object and the fetchTdDeps reference outside the
// factory so each useAppStore() call returns the same object identity. If we
// build a fresh object inside the factory, fetchTdDeps gets a new vi.fn() ref
// every render — TaskGraphView's effect depends on fetchTdDeps, so it re-fires
// on every render and the `loaded` state churns false→true→false, leading to
// flaky tests where handles disappear mid-assertion.
const fetchTdDepsMock = vi.fn().mockResolvedValue(undefined)
const storeShape = {
  tdDepsByProject: { '/repo': MOCK_DEPS },
  fetchTdDeps: fetchTdDepsMock,
}
vi.mock('@/lib/store', () => ({
  useAppStore: () => storeShape,
}))

describe('TaskGraphView (DOM render)', () => {
  it('renders nodes with source+target handles wired so edges can attach', async () => {
    const { default: TaskGraphView } = await import('./TaskGraphView')

    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <TaskGraphView
          projectPath="/repo"
          issues={MOCK_ISSUES}
          searchQuery=""
          onSelect={vi.fn()}
        />
      </div>,
    )

    // Wait for the lazy fetchTdDeps to resolve, nodes to render, and handles
    // to attach. Regression guard for the "Couldn't create edge for source
    // handle id: null" bug — the custom node MUST render a source AND target
    // Handle for react-flow to attach edges to it. In jsdom we can't reliably
    // assert rendered SVG edge paths (handle measurement depends on layout that
    // jsdom doesn't perform), so we assert the structural prerequisite instead.
    await waitFor(
      () => {
        const nodes = container.querySelectorAll('.react-flow__node')
        expect(nodes.length).toBe(3)
        const sourceHandles = container.querySelectorAll(
          '.react-flow__handle.source',
        )
        const targetHandles = container.querySelectorAll(
          '.react-flow__handle.target',
        )
        // Each of the 3 nodes contributes one source and one target handle.
        expect(sourceHandles.length).toBe(3)
        expect(targetHandles.length).toBe(3)
      },
      { timeout: 3000 },
    )

    cleanup()
  })

  it('still mounts cleanly with no edges and shows no empty-state overlay', async () => {
    // Per c1a6224 the empty-state overlay is intentionally NOT rendered —
    // an empty graph already conveys "no relationships". Pin that contract.
    const { default: TaskGraphView } = await import('./TaskGraphView')
    const issuesNoRels = [
      makeIssue({ id: 'td-x', title: 'Lonely 1' }),
      makeIssue({ id: 'td-y', title: 'Lonely 2' }),
    ]

    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <TaskGraphView
          projectPath="/repo"
          issues={issuesNoRels}
          searchQuery=""
          onSelect={vi.fn()}
        />
      </div>,
    )

    await waitFor(
      () => {
        expect(
          container.querySelectorAll('.react-flow__node').length,
        ).toBeGreaterThanOrEqual(2)
      },
      { timeout: 3000 },
    )

    expect(container.textContent).not.toMatch(/no structural relationships/i)

    cleanup()
  })

  it('fires onSelect when a node is clicked (regression guard for pointer-events:none)', async () => {
    const { default: TaskGraphView } = await import('./TaskGraphView')
    const onSelect = vi.fn()

    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <TaskGraphView
          projectPath="/repo"
          issues={MOCK_ISSUES}
          searchQuery=""
          onSelect={onSelect}
        />
      </div>,
    )

    await waitFor(
      () => {
        expect(container.querySelectorAll('.react-flow__node').length).toBe(3)
      },
      { timeout: 3000 },
    )

    // Click the node wrapper. ReactFlow's onNodeClick is attached there. If
    // the wrapper carries pointer-events:none (the bug fixed in this branch)
    // the click never lands and onSelect stays uncalled.
    const firstNode = container.querySelector('.react-flow__node') as HTMLElement
    expect(firstNode).toBeTruthy()
    firstNode.click()

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalled()
    })

    cleanup()
  })
})
