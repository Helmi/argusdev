import type { Terminal, ILinkProvider, ILink } from 'xterm'

// Bare file paths: at least one `/`, ends with extension, optional :line:col
// Supports relative (./foo, ../foo, foo/bar), absolute (/usr/...), and home (~/.config/...)
const FILE_PATH_RE =
  /(?:^|(?<=[\s:'"(,]))((~\/|\.{0,2}\/)?[a-zA-Z0-9_@.+-]+(?:\/[a-zA-Z0-9_@.+-]+)+\.[a-zA-Z]{1,10}(?::\d+(?::\d+)?)?)/g

// Markdown-style links: [display text](path)
const MD_LINK_RE = /\[([^\]]{1,100})\]\(([^)]{1,300})\)/g

function stripLineColSuffix(path: string): string {
  return path.replace(/:\d+(?::\d+)?$/, '')
}

export function createFilePathLinkProvider(
  terminal: Terminal,
  onActivate: (filePath: string) => void,
): ILinkProvider {
  return {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: ILink[] | undefined) => void,
    ): void {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1)
      if (!line) {
        callback(undefined)
        return
      }
      const text = line.translateToString(true)
      const links: ILink[] = []

      // Markdown-style links (checked first so they take priority)
      MD_LINK_RE.lastIndex = 0
      let mdMatch: RegExpExecArray | null
      while ((mdMatch = MD_LINK_RE.exec(text)) !== null) {
        const fullMatch = mdMatch[0]
        const linkPath = mdMatch[2]
        if (linkPath.includes('://')) continue

        const startCol = mdMatch.index + 1
        links.push({
          range: {
            start: { x: startCol, y: bufferLineNumber },
            end: { x: startCol + fullMatch.length - 1, y: bufferLineNumber },
          },
          text: fullMatch,
          decorations: { pointerCursor: true, underline: true },
          activate: () => onActivate(stripLineColSuffix(linkPath)),
        })
      }

      // Bare file paths
      FILE_PATH_RE.lastIndex = 0
      let fileMatch: RegExpExecArray | null
      while ((fileMatch = FILE_PATH_RE.exec(text)) !== null) {
        const matchedPath = fileMatch[1]
        if (matchedPath.includes('://')) continue

        // Skip if this range overlaps with an existing markdown link
        const startCol = fileMatch.index + (fileMatch[0].length - matchedPath.length) + 1
        const endCol = startCol + matchedPath.length - 1
        const overlaps = links.some(
          (l) =>
            l.range.start.y === bufferLineNumber &&
            startCol <= l.range.end.x &&
            endCol >= l.range.start.x,
        )
        if (overlaps) continue

        links.push({
          range: {
            start: { x: startCol, y: bufferLineNumber },
            end: { x: endCol, y: bufferLineNumber },
          },
          text: matchedPath,
          decorations: { pointerCursor: true, underline: true },
          activate: () => onActivate(stripLineColSuffix(matchedPath)),
        })
      }

      callback(links.length > 0 ? links : undefined)
    },
  }
}
