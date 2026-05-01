import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'client/src/components/TerminalSession.tsx'), 'utf8')
}

describe('TerminalSession Pi cursor-filter (td-52e9cf)', () => {
  it('declares isPiSession gated on session.normalizedAgentType === "pi"', () => {
    const source = readSource()
    expect(source).toMatch(/const\s+isPiSession\s*=\s*session\.normalizedAgentType\s*===\s*'pi'/)
  })

  it('declares piCursorPattern regex matching \\x1b[?25l and \\x1b[?25h', () => {
    const source = readSource()
    expect(source).toMatch(/const\s+piCursorPattern\s*=\s*\/\\x1b\\\[\\\?25\[lh\]\/g/)
  })

  it('applies piCursorPattern replace inside isPiSession gate on incoming path', () => {
    const source = readSource()
    // The replace must appear inside an isPiSession ternary or if-gate
    const gated = /isPiSession\s*\?\s*content\.replace\(\s*piCursorPattern\s*,\s*''\s*\)\s*:\s*content/
    expect(source).toMatch(gated)
  })

  it('does NOT apply piCursorPattern unconditionally', () => {
    const source = readSource()
    const replaceRe = /\.replace\(\s*piCursorPattern\b/g
    const matches = [...source.matchAll(replaceRe)]
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      const start = Math.max(0, (m.index ?? 0) - 120)
      const window = source.slice(start, m.index)
      expect(window).toMatch(/isPiSession/)
    }
  })

  it('filter logic: strips \\x1b[?25l and \\x1b[?25h for Pi, passes through for other agents', () => {
    const piCursorPattern = /\x1b\[\?25[lh]/g
    const apply = (normalizedAgentType: string, data: string) => {
      const isPi = normalizedAgentType === 'pi'
      return isPi ? data.replace(piCursorPattern, '') : data
    }

    const hideCursor = '\x1b[?25l'
    const showCursor = '\x1b[?25h'
    const sample = `hello${hideCursor}world${showCursor}tail`

    expect(apply('pi', sample)).toBe('helloworldtail')
    expect(apply('claude', sample)).toBe(sample)
    expect(apply('codex', sample)).toBe(sample)
    expect(apply('gemini', sample)).toBe(sample)
    expect(apply('opencode', sample)).toBe(sample)
  })

  it('no false-positive: other DECSET/RST modes pass through for Pi unchanged', () => {
    const piCursorPattern = /\x1b\[\?25[lh]/g
    const applyForPi = (data: string) => data.replace(piCursorPattern, '')

    // Bracketed paste mode, mouse tracking, altscreen, synchronized output
    const other = '\x1b[?2004h\x1b[?1049h\x1b[?1l\x1b[?1004h\x1b[?2026h\x1b[?2026l'
    expect(applyForPi(other)).toBe(other)

    // Heartbeat stream — only hide cursor gets stripped
    expect(applyForPi('\x1b[?25l')).toBe('')
    expect(applyForPi('\x1b[?25h')).toBe('')
    expect(applyForPi('\x1b[?25lhello\x1b[?25h')).toBe('hello')
  })

  it('regression (td-b3a548): custom profile wrapping pi via normalizedAgentType triggers gate', () => {
    const piCursorPattern = /\x1b\[\?25[lh]/g
    const gate = (session: {agentId?: string; normalizedAgentType?: string}, data: string) => {
      const isPi = session.normalizedAgentType === 'pi'
      return isPi ? data.replace(piCursorPattern, '') : data
    }

    const sample = `before\x1b[?25lafter`
    expect(gate({agentId: 'my-pi', normalizedAgentType: 'pi'}, sample)).toBe('beforeafter')
    expect(gate({agentId: 'pi', normalizedAgentType: 'pi'}, sample)).toBe('beforeafter')
    // A session that just names itself pi but has no normalized type must not trigger
    expect(gate({agentId: 'pi', normalizedAgentType: undefined}, sample)).toBe(sample)
  })
})
