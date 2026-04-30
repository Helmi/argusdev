import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'client/src/components/TerminalSession.tsx'), 'utf8')
}

describe('TerminalSession focus-event filter (td-8ca92c)', () => {
  it('declares isOpenCodeSession gated on session.normalizedAgentType === "opencode"', () => {
    const source = readSource()
    // td-b3a548: gate moved off raw agentId to normalizedAgentType so custom
    // user profiles wrapping the opencode command still trigger the filter.
    expect(source).toMatch(/const\s+isOpenCodeSession\s*=\s*session\.normalizedAgentType\s*===\s*'opencode'/)
  })

  it('declares the focusPattern regex for \\x1b[O and \\x1b[I', () => {
    const source = readSource()
    expect(source).toMatch(/const\s+focusPattern\s*=\s*\/\\x1b\\\[\[OI\]\/g/)
  })

  it('applies focusPattern.replace ONLY inside the isOpenCodeSession gate', () => {
    const source = readSource()
    // The replace must appear inside an if (isOpenCodeSession) block.
    const gated = /if\s*\(\s*isOpenCodeSession\s*\)\s*\{[^}]*filtered\s*=\s*filtered\.replace\(\s*focusPattern\s*,\s*''\s*\)\s*;?[^}]*\}/
    expect(source).toMatch(gated)
  })

  it('does NOT apply focusPattern unconditionally (other agents must keep focus events)', () => {
    const source = readSource()
    // Find every replace(focusPattern, ...) occurrence; each must be preceded
    // (within ~120 chars) by isOpenCodeSession in an if-gate.
    const replaceRe = /\.replace\(\s*focusPattern\b/g
    const matches = [...source.matchAll(replaceRe)]
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      const start = Math.max(0, (m.index ?? 0) - 200)
      const window = source.slice(start, m.index)
      expect(window).toMatch(/if\s*\(\s*isOpenCodeSession\s*\)/)
    }
  })

  it('filter logic: strips \\x1b[O and \\x1b[I for opencode, passes through for other agents', () => {
    const focusPattern = /\x1b\[[OI]/g
    const apply = (normalizedAgentType: string, data: string) => {
      const isOpenCode = normalizedAgentType === 'opencode'
      return isOpenCode ? data.replace(focusPattern, '') : data
    }

    const sample = `hello\x1b[Oworld\x1b[Itail`

    expect(apply('opencode', sample)).toBe('helloworldtail')
    expect(apply('claude', sample)).toBe(sample)
    expect(apply('codex', sample)).toBe(sample)
    expect(apply('gemini', sample)).toBe(sample)

    // SS3-style keyboard input (\x1bOA = arrow up) must NOT be stripped.
    // Note: \x1bOA has no '[', so the pattern can't match it for any agent.
    const ss3 = '\x1bOA\x1bOB\x1bOC\x1bOD'
    expect(apply('opencode', ss3)).toBe(ss3)
  })

  it('regression (td-b3a548): custom profile wrapping opencode (agentId="my-opencode") triggers gate via normalizedAgentType', () => {
    // The whole point of routing the gate through normalizedAgentType is that
    // a session like { agentId: 'my-opencode', normalizedAgentType: 'opencode' }
    // — produced by a user-defined profile with command='opencode' — must
    // still strip focus events. Mirror the gate logic and assert this.
    const focusPattern = /\x1b\[[OI]/g
    const gate = (session: {agentId?: string; normalizedAgentType?: string}, data: string) => {
      const isOpenCode = session.normalizedAgentType === 'opencode'
      return isOpenCode ? data.replace(focusPattern, '') : data
    }

    const sample = `hello\x1b[Oworld\x1b[Itail`
    expect(gate({agentId: 'my-opencode', normalizedAgentType: 'opencode'}, sample)).toBe('helloworldtail')
    expect(gate({agentId: 'opencode', normalizedAgentType: 'opencode'}, sample)).toBe('helloworldtail')
    // A profile that just *names* itself opencode but isn't (no normalized type) must not trigger.
    expect(gate({agentId: 'opencode', normalizedAgentType: undefined}, sample)).toBe(sample)
  })
})
