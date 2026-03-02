import { describe, expect, it } from 'vitest'
import type { TdIssueWithChildren, TdIssue } from '../lib/types'
import {
  getLinkedSessions,
  getTaskDetailLayoutCounts,
  hasSchedulingDetails,
  parseAcceptanceCriteria,
  getChildGroup,
  groupChildrenByStatus,
} from '../lib/taskDetailLayout'

function makeIssue(overrides: Partial<TdIssueWithChildren> = {}): TdIssueWithChildren {
  return {
    id: 'td-1',
    title: 'Task title',
    description: '',
    status: 'open',
    type: 'task',
    priority: 'P1',
    points: 0,
    labels: '',
    parent_id: '',
    acceptance: '',
    implementer_session: '',
    reviewer_session: '',
    created_at: '2026-02-20 08:30:10 +0000 UTC',
    updated_at: '2026-02-20 08:30:10 +0000 UTC',
    closed_at: null,
    deleted_at: null,
    minor: 0,
    created_branch: '',
    creator_session: '',
    sprint: '',
    defer_until: null,
    due_date: null,
    defer_count: 0,
    children: [],
    handoffs: [],
    files: [],
    comments: [],
    ...overrides,
  }
}

describe('TaskDetailModal layout helpers', () => {
  it('parses acceptance criteria into clean list items', () => {
    expect(parseAcceptanceCriteria('')).toEqual([])
    expect(
      parseAcceptanceCriteria(`
        - has docs
        * has tests
        plain line
      `)
    ).toEqual(['has docs', 'has tests', 'plain line'])
  })

  it('returns trimmed linked sessions and skips blank entries', () => {
    expect(
      getLinkedSessions({
        implementer_session: ' ses_impl ',
        reviewer_session: '   ',
      })
    ).toEqual([{ label: 'Implementer', id: 'ses_impl' }])
  })

  it('builds tab section counts for dense issues', () => {
    const issue = makeIssue({
      description: 'Some description',
      acceptance: '- one\n- two',
      labels: 'webui, ux',
      points: 3,
      implementer_session: 'ses_impl',
      reviewer_session: 'ses_rev',
      children: [
        makeIssue({ id: 'td-child-1', title: 'child' }),
      ],
      handoffs: [
        {
          id: 'handoff-1',
          issueId: 'td-1',
          sessionId: 'ses_impl',
          done: ['a'],
          remaining: ['b'],
          decisions: [],
          uncertain: [],
          timestamp: '2026-02-20 08:30:10 +0000 UTC',
        },
      ],
      comments: [
        {
          id: 'comment-1',
          issue_id: 'td-1',
          session_id: 'ses_impl',
          text: 'Looks good.',
          created_at: '2026-02-20 08:30:10 +0000 UTC',
        },
      ],
      files: [
        {
          id: 'file-1',
          issue_id: 'td-1',
          file_path: 'client/src/components/TaskDetailModal.tsx',
          role: 'implementation',
        },
      ],
    })

    expect(getTaskDetailLayoutCounts(issue)).toEqual({
      overview: 4,
      activity: 3,
      details: 3,
    })
  })

  it('keeps details tab available even when optional sections are empty', () => {
    const issue = makeIssue()
    expect(getTaskDetailLayoutCounts(issue)).toEqual({
      overview: 0,
      activity: 0,
      details: 1,
    })
  })

  it('adds scheduling section count only when scheduling values exist', () => {
    const withScheduling = makeIssue({
      due_date: '2026-02-25',
    })
    const withoutScheduling = makeIssue()

    expect(hasSchedulingDetails(withScheduling)).toBe(true)
    expect(hasSchedulingDetails(withoutScheduling)).toBe(false)

    expect(getTaskDetailLayoutCounts(withScheduling)).toEqual({
      overview: 0,
      activity: 0,
      details: 2,
    })
  })

  it('treats defer_count as scheduling detail', () => {
    const issue = makeIssue({
      defer_count: 2,
    })

    expect(hasSchedulingDetails(issue)).toBe(true)
    expect(getTaskDetailLayoutCounts(issue)).toEqual({
      overview: 0,
      activity: 0,
      details: 2,
    })
  })

  it('keeps acceptance criteria as a visible overview section without description', () => {
    const issue = makeIssue({
      acceptance: '- must pass',
    })

    expect(getTaskDetailLayoutCounts(issue)).toEqual({
      overview: 1,
      activity: 0,
      details: 1,
    })
  })

  it('counts comments section as activity when comments exist', () => {
    const issue = makeIssue({
      comments: [
        {
          id: 'comment-1',
          issue_id: 'td-1',
          session_id: 'ses_reviewer',
          text: 'Needs one more test.',
          created_at: '2026-02-20 08:30:10 +0000 UTC',
        },
      ],
    })

    expect(getTaskDetailLayoutCounts(issue)).toEqual({
      overview: 0,
      activity: 1,
      details: 1,
    })
  })

  it('does not throw when comments payload is missing', () => {
    const legacy = makeIssue()
    delete (legacy as { comments?: unknown }).comments

    expect(() => getTaskDetailLayoutCounts(legacy)).not.toThrow()
    expect(getTaskDetailLayoutCounts(legacy)).toEqual({
      overview: 0,
      activity: 0,
      details: 1,
    })
  })
})

function makeChild(overrides: Partial<TdIssue> = {}): TdIssue {
  return {
    id: 'td-child',
    title: 'Child task',
    description: '',
    status: 'open',
    type: 'task',
    priority: 'P1',
    points: 0,
    labels: '',
    parent_id: 'td-1',
    acceptance: '',
    implementer_session: '',
    reviewer_session: '',
    created_at: '2026-02-20 08:30:10 +0000 UTC',
    updated_at: '2026-02-20 08:30:10 +0000 UTC',
    closed_at: null,
    deleted_at: null,
    minor: 0,
    created_branch: '',
    creator_session: '',
    sprint: '',
    defer_until: null,
    due_date: null,
    defer_count: 0,
    ...overrides,
  }
}

describe('getChildGroup', () => {
  it('groups closed tasks as closed', () => {
    expect(getChildGroup(makeChild({ status: 'closed' }))).toBe('closed')
  })

  it('groups in_review tasks as in_review', () => {
    expect(getChildGroup(makeChild({ status: 'in_review' }))).toBe('in_review')
  })

  it('groups in_progress tasks with reviewer_session as needs-fix', () => {
    const child = makeChild({
      status: 'in_progress',
      reviewer_session: 'ses_reviewer',
    })
    expect(getChildGroup(child)).toBe('needs-fix')
  })

  it('groups in_progress tasks without reviewer_session as open', () => {
    expect(getChildGroup(makeChild({ status: 'in_progress' }))).toBe('open')
  })

  it('groups open tasks as open', () => {
    expect(getChildGroup(makeChild({ status: 'open' }))).toBe('open')
  })
})

describe('groupChildrenByStatus', () => {
  it('groups children in correct order: needs-fix, in_review, open, closed', () => {
    const children = [
      makeChild({ id: 'td-open', status: 'open' }),
      makeChild({ id: 'td-closed', status: 'closed' }),
      makeChild({ id: 'td-needsfix', status: 'in_progress', reviewer_session: 'ses_rev' }),
      makeChild({ id: 'td-review', status: 'in_review' }),
    ]

    const grouped = groupChildrenByStatus(children)

    expect(grouped['needs-fix'].map(c => c.id)).toEqual(['td-needsfix'])
    expect(grouped['in_review'].map(c => c.id)).toEqual(['td-review'])
    expect(grouped['open'].map(c => c.id)).toEqual(['td-open'])
    expect(grouped['closed'].map(c => c.id)).toEqual(['td-closed'])
  })

  it('returns empty arrays for groups with no children', () => {
    const grouped = groupChildrenByStatus([])

    expect(grouped['needs-fix']).toEqual([])
    expect(grouped['in_review']).toEqual([])
    expect(grouped['open']).toEqual([])
    expect(grouped['closed']).toEqual([])
  })
})
