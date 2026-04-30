import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveProjectPathForWorktree } from '../lib/tdWorktreeResolver'

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Board UX regression checks', () => {
  it('conditionally shows the task board button based on td status', () => {
    const source = readSource('client/src/components/TerminalSession.tsx')
    expect(source).toContain('title="Task board"')
    expect(source).toContain('tdStatus?.projectState?.enabled')
  })

  it('routes task board via resolveProjectPathForWorktree, not currentProject', () => {
    const terminalSource = readSource('client/src/components/TerminalSession.tsx')
    const sdkSource = readSource('client/src/components/SdkSession.tsx')
    // Must use resolver, not global currentProject
    expect(terminalSource).toContain('resolveProjectPathForWorktree')
    expect(sdkSource).toContain('resolveProjectPathForWorktree')
    // openTaskBoard must receive a derived path argument
    expect(terminalSource).toContain('openTaskBoard(projectPath)')
    expect(sdkSource).toContain('openTaskBoard(projectPath)')
    // Must not fall back to currentProject for task board routing
    expect(terminalSource).not.toContain('currentProject')
    expect(sdkSource).not.toContain('currentProject')
  })

  it('resolves session in project A even when currentProject is project B', () => {
    const projectA = '/home/user/projects/alpha'
    const projectB = '/home/user/projects/beta'
    const sessionInA = '/home/user/projects/alpha/.worktrees/feature-x'

    // The real resolver must route to projectA regardless of any global state
    const resolved = resolveProjectPathForWorktree(sessionInA, [projectA, projectB])
    expect(resolved).toBe(projectA)
  })

  it('uses count-aware "Show N older" text for closed-column progressive reveal', () => {
    const source = readSource('client/src/components/TaskBoard.tsx')
    expect(source).toContain('Show {hiddenClosedCount} older')
  })

  it('threads projectPath explicitly through openConversationView and sidebar context menu', () => {
    const storeSource = readSource('client/src/lib/store.tsx')
    const sidebarSource = readSource('client/src/components/layout/Sidebar.tsx')
    const conversationSource = readSource('client/src/components/ConversationView.tsx')

    // store must expose conversationViewProjectPath
    expect(storeSource).toContain('conversationViewProjectPath')
    // openConversationView must accept projectPath in context arg
    expect(storeSource).toContain('context?.projectPath')
    // sidebar must pass project.path directly, not call ensureProjectSelected
    expect(sidebarSource).toContain('openConversationView({projectPath: project.path})')
    expect(sidebarSource).not.toContain('ensureProjectSelected')
    // ConversationView must read conversationViewProjectPath, not currentProject
    expect(conversationSource).toContain('conversationViewProjectPath')
    expect(conversationSource).not.toContain('currentProject')
  })

  it('uses per-project tdIssues store to eliminate last-write-wins race', () => {
    const storeSource = readSource('client/src/lib/store.tsx')
    const boardSource = readSource('client/src/components/TaskBoard.tsx')
    // store must use per-project map, not global array
    expect(storeSource).toContain('tdIssuesByProject')
    expect(storeSource).not.toContain('setTdIssues(')
    // TaskBoard must derive its slice from the map, not destructure a global tdIssues
    expect(boardSource).toContain('tdIssuesByProject')
    expect(boardSource).not.toContain('tdIssues,')
  })

  it('exposes a graph view mode in TaskBoard with lazy-loaded graph component', () => {
    const boardSource = readSource('client/src/components/TaskBoard.tsx')
    // ViewMode must include 'graph' alongside 'board' and 'list'
    expect(boardSource).toMatch(/ViewMode\s*=\s*'board'\s*\|\s*'list'\s*\|\s*'graph'/)
    // Graph component must be lazy-loaded (don't pay bundle cost unless opened)
    expect(boardSource).toContain('lazy(() => import(')
    expect(boardSource).toContain('TaskGraphView')
    // Toggle button for graph view present in toolbar
    expect(boardSource).toContain("title=\"Graph view\"")
    expect(boardSource).toContain("setViewMode('graph')")
  })

  it('graph view dims non-matching nodes via opacity, never removes them', () => {
    const graphSource = readSource('client/src/components/TaskGraphView.tsx')
    // Highlighting is computed and applied to nodes; non-matching nodes get
    // an opacity-30 dim class rather than being filtered out.
    expect(graphSource).toContain('computeHighlighted')
    expect(graphSource).toContain('opacity-30')
    // Edge styling uses dashed strokes for depends-on (vs solid for parent)
    expect(graphSource).toContain('strokeDasharray')
    // Custom node MUST declare source + target Handles or react-flow can't
    // attach edges (regression for "Couldn't create edge for source handle id: null").
    expect(graphSource).toMatch(/<Handle\s+type="target"/)
    expect(graphSource).toMatch(/<Handle\s+type="source"/)
    // Attribution badge required by @xyflow/react MIT license — must NOT be hidden.
    expect(graphSource).not.toContain('hideAttribution')
  })

  it('forwards projectPath when fetching task detail so cross-project clicks resolve', () => {
    const modalSource = readSource('client/src/components/TaskDetailModal.tsx')
    // Modal must include projectPath in the issue fetch URL when known —
    // otherwise the daemon falls back to its selected project and returns
    // "Issue not found" for tasks belonging to other registered projects.
    expect(modalSource).toContain('/api/td/issues/${issueId}?projectPath=')
    const apiSource = readSource('src/services/apiServer.ts')
    // Server-side route must accept projectPath as a query param.
    expect(apiSource).toMatch(
      /'\/api\/td\/issues\/:id'[\s\S]{0,400}requestedProjectPath/,
    )
  })

  it('graph backend wiring uses bulk dependency endpoint, not per-issue fetches', () => {
    const apiSource = readSource('src/services/apiServer.ts')
    const readerSource = readSource('src/services/tdReader.ts')
    const storeSource = readSource('client/src/lib/store.tsx')
    expect(apiSource).toContain("'/api/td/dependencies'")
    expect(readerSource).toContain('getAllDependencies()')
    expect(storeSource).toContain('fetchTdDeps')
    expect(storeSource).toContain('tdDepsByProject')
  })
})
