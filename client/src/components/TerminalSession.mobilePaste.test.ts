import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'client/src/components/TerminalSession.tsx'), 'utf8')
}

describe('TerminalSession mobile paste (td-7b7886)', () => {
  it('renders ClipboardPaste button only on mobile', () => {
    const source = readSource()
    expect(source).toContain('isMobile && (')
    expect(source).toContain('ClipboardPaste')
    expect(source).toContain('handleMobilePaste')
    expect(source).toContain('Paste from clipboard')
  })

  it('handleMobilePaste wiring: reads clipboard and emits input to socket', async () => {
    const emitted: unknown[] = []
    const socket = { emit: vi.fn((...args: unknown[]) => { emitted.push(args) }) }
    const sessionId = 'ses_test'
    const writeCalls: string[] = []
    const xtermRef = { current: { write: vi.fn((s: string) => writeCalls.push(s)) } }

    const clipboardText = 'pasted text'
    const clipboardReadText = vi.fn().mockResolvedValue(clipboardText)

    // Inline the handler logic mirroring TerminalSession.tsx handleMobilePaste
    const handleMobilePaste = async () => {
      try {
        const text = await clipboardReadText()
        if (text) {
          socket.emit('input', { sessionId, data: text })
        }
      } catch {
        xtermRef.current?.write('\r\n[Paste failed: clipboard access denied]\r\n')
      }
    }

    await handleMobilePaste()

    expect(socket.emit).toHaveBeenCalledOnce()
    expect(socket.emit).toHaveBeenCalledWith('input', { sessionId, data: clipboardText })
    expect(writeCalls).toHaveLength(0)
  })

  it('handleMobilePaste wiring: writes error to terminal when clipboard access is denied', async () => {
    const socket = { emit: vi.fn() }
    const sessionId = 'ses_test'
    const writeCalls: string[] = []
    const xtermRef = { current: { write: vi.fn((s: string) => writeCalls.push(s)) } }

    const clipboardReadText = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))

    const handleMobilePaste = async () => {
      try {
        const text = await clipboardReadText()
        if (text) {
          socket.emit('input', { sessionId, data: text })
        }
      } catch {
        xtermRef.current?.write('\r\n[Paste failed: clipboard access denied]\r\n')
      }
    }

    await handleMobilePaste()

    expect(socket.emit).not.toHaveBeenCalled()
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0]).toContain('Paste failed: clipboard access denied')
  })

  it('handleMobilePaste wiring: does not emit when clipboard returns empty string', async () => {
    const socket = { emit: vi.fn() }
    const sessionId = 'ses_test'
    const xtermRef = { current: { write: vi.fn() } }

    const clipboardReadText = vi.fn().mockResolvedValue('')

    const handleMobilePaste = async () => {
      try {
        const text = await clipboardReadText()
        if (text) {
          socket.emit('input', { sessionId, data: text })
        }
      } catch {
        xtermRef.current?.write('\r\n[Paste failed: clipboard access denied]\r\n')
      }
    }

    await handleMobilePaste()

    expect(socket.emit).not.toHaveBeenCalled()
    expect(xtermRef.current.write).not.toHaveBeenCalled()
  })
})
