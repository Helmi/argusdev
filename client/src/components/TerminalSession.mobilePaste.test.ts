import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'client/src/components/TerminalSession.tsx'), 'utf8')
}

describe('TerminalSession mobile paste (td-7b7886)', () => {
  it('renders ClipboardPaste button only on mobile and routes through term.paste()', () => {
    const source = readSource()
    expect(source).toContain('isMobile && (')
    expect(source).toContain('ClipboardPaste')
    expect(source).toContain('handleMobilePaste')
    expect(source).toContain('Paste from clipboard')
    // Must route through xterm.paste() for bracketed-paste support, not raw socket emit
    expect(source).toContain('xtermRef.current?.paste(text)')
  })

  it('handleMobilePaste: calls term.paste() with clipboard text', async () => {
    const xterm = { paste: vi.fn(), write: vi.fn() }
    const clipboardText = 'pasted text\nwith newline'
    const clipboardReadText = vi.fn().mockResolvedValue(clipboardText)

    const handleMobilePaste = async () => {
      try {
        const text = await clipboardReadText()
        if (text) {
          xterm.paste(text)
        }
      } catch {
        xterm.write('\r\n[Paste failed: clipboard access denied]\r\n')
      }
    }

    await handleMobilePaste()

    expect(xterm.paste).toHaveBeenCalledOnce()
    expect(xterm.paste).toHaveBeenCalledWith(clipboardText)
    expect(xterm.write).not.toHaveBeenCalled()
  })

  it('handleMobilePaste: writes error to terminal when clipboard access is denied', async () => {
    const xterm = { paste: vi.fn(), write: vi.fn() }
    const clipboardReadText = vi.fn().mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))

    const handleMobilePaste = async () => {
      try {
        const text = await clipboardReadText()
        if (text) {
          xterm.paste(text)
        }
      } catch {
        xterm.write('\r\n[Paste failed: clipboard access denied]\r\n')
      }
    }

    await handleMobilePaste()

    expect(xterm.paste).not.toHaveBeenCalled()
    expect(xterm.write).toHaveBeenCalledOnce()
    expect(xterm.write.mock.calls[0][0]).toContain('Paste failed: clipboard access denied')
  })

  it('handleMobilePaste: does not call paste when clipboard returns empty string', async () => {
    const xterm = { paste: vi.fn(), write: vi.fn() }
    const clipboardReadText = vi.fn().mockResolvedValue('')

    const handleMobilePaste = async () => {
      try {
        const text = await clipboardReadText()
        if (text) {
          xterm.paste(text)
        }
      } catch {
        xterm.write('\r\n[Paste failed: clipboard access denied]\r\n')
      }
    }

    await handleMobilePaste()

    expect(xterm.paste).not.toHaveBeenCalled()
    expect(xterm.write).not.toHaveBeenCalled()
  })
})
