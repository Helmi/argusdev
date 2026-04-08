import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Board UX regression checks', () => {
  it('conditionally shows the task board button based on td status', () => {
    const source = readSource('client/src/components/TerminalSession.tsx')
    expect(source).toContain('title="Task board"')
    expect(source).toContain('tdStatus?.projectState?.enabled')
  })

  it('uses count-aware "Show N older" text for closed-column progressive reveal', () => {
    const source = readSource('client/src/components/TaskBoard.tsx')
    expect(source).toContain('Show {hiddenClosedCount} older')
  })
})
