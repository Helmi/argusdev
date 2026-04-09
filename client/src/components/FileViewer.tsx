import { useState, useEffect, useRef, useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, Keyboard, Loader2, FileWarning, FileX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getLanguage } from '@/lib/fileUtils'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

// Format file size
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileViewer() {
  const { viewingFile, closeFile } = useAppStore()

  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isBinary, setIsBinary] = useState(false)
  const [tooLarge, setTooLarge] = useState(false)
  const [fileSize, setFileSize] = useState(0)
  const [showHelp, setShowHelp] = useState(false)
  const [focusedLine, setFocusedLine] = useState(0)

  const containerRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])

  const worktreePath = viewingFile?.worktreePath
  const filePath = viewingFile?.filePath

  const lines = useMemo(() => content.split('\n'), [content])

  // Fetch file content
  useEffect(() => {
    if (!worktreePath || !filePath) return

    const fetchFile = async () => {
      setLoading(true)
      setError(null)
      setIsBinary(false)
      setTooLarge(false)
      setFocusedLine(0)
      try {
        const response = await fetch(
          `/api/worktree/file?path=${encodeURIComponent(worktreePath)}&file=${encodeURIComponent(filePath)}`
        )
        if (!response.ok) {
          throw new Error('Failed to fetch file')
        }
        const data = await response.json()

        if (data.isBinary) {
          setIsBinary(true)
          setContent('')
        } else if (data.tooLarge) {
          setTooLarge(true)
          setContent('')
        } else {
          setContent(data.content || '')
        }
        setFileSize(data.size || 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchFile()
  }, [worktreePath, filePath])

  // Scroll focused line into view
  useEffect(() => {
    lineRefs.current[focusedLine]?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [focusedLine])

  // Keyboard navigation
  useEffect(() => {
    if (!viewingFile) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'Escape':
          closeFile()
          break
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          setFocusedLine((prev) => Math.min(prev + 1, lines.length - 1))
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          setFocusedLine((prev) => Math.max(prev - 1, 0))
          break
        case 'g':
          if (e.shiftKey) {
            e.preventDefault()
            setFocusedLine(lines.length - 1)
          } else {
            e.preventDefault()
            setFocusedLine(0)
          }
          break
        case '?':
          e.preventDefault()
          setShowHelp((prev) => !prev)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewingFile, closeFile, lines.length])

  if (!viewingFile || !filePath) {
    return null
  }

  const fileName = filePath.split('/').pop() || filePath
  const dirPath = filePath.includes('/')
    ? filePath.slice(0, filePath.lastIndexOf('/'))
    : ''
  const language = getLanguage(fileName)

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-8 items-center justify-between border-b border-border px-3 bg-card shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="font-mono text-sm truncate flex items-center gap-2">
            <span className="text-muted-foreground">{dirPath && `${dirPath}/`}</span>
            <span className="text-foreground font-semibold">{fileName}</span>
          </div>

          {!loading && !error && (
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground shrink-0">
              <span>{formatSize(fileSize)}</span>
              <span className="text-border">•</span>
              <span>{language}</span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Help button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setShowHelp((prev) => !prev)}
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="h-3 w-3" />
          </Button>

          {/* Close button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 ml-2"
            onClick={closeFile}
            title="Close (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Help overlay */}
      {showHelp && (
        <div className="absolute inset-0 z-10 bg-background/95 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-card border border-border rounded-lg p-6 max-w-md shadow-xl">
            <h3 className="font-semibold text-lg mb-4">Keyboard Shortcuts</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 font-mono text-sm">
              <span className="text-muted-foreground">Navigation</span>
              <span></span>
              <kbd className="px-1.5 py-0.5 bg-secondary rounded text-xs">j / ↓</kbd>
              <span>Next line</span>
              <kbd className="px-1.5 py-0.5 bg-secondary rounded text-xs">k / ↑</kbd>
              <span>Previous line</span>
              <kbd className="px-1.5 py-0.5 bg-secondary rounded text-xs">g</kbd>
              <span>Go to top</span>
              <kbd className="px-1.5 py-0.5 bg-secondary rounded text-xs">G</kbd>
              <span>Go to bottom</span>

              <span className="text-muted-foreground mt-2">Other</span>
              <span></span>
              <kbd className="px-1.5 py-0.5 bg-secondary rounded text-xs">?</kbd>
              <span>Toggle help</span>
              <kbd className="px-1.5 py-0.5 bg-secondary rounded text-xs">Esc</kbd>
              <span>Close</span>
            </div>
            <Button
              className="mt-6 w-full"
              variant="secondary"
              onClick={() => setShowHelp(false)}
            >
              Close
            </Button>
          </div>
        </div>
      )}

      {/* File content */}
      <div ref={containerRef} className="flex-1 overflow-hidden relative" tabIndex={0}>
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-mono text-sm">Loading file...</span>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-destructive">
            <span className="font-mono text-sm">{error}</span>
          </div>
        ) : isBinary ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <FileWarning className="h-8 w-8" />
            <span className="font-mono text-sm">Binary file cannot be displayed</span>
            <span className="font-mono text-xs text-muted-foreground/70">{formatSize(fileSize)}</span>
          </div>
        ) : tooLarge ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <FileX className="h-8 w-8" />
            <span className="font-mono text-sm">File too large to display</span>
            <span className="font-mono text-xs text-muted-foreground/70">{formatSize(fileSize)} (max 1 MB)</span>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="font-mono text-[13px] leading-6">
              {lines.map((line, idx) => (
                <div
                  key={idx}
                  ref={(el) => (lineRefs.current[idx] = el)}
                  className={cn(
                    'flex hover:bg-muted/30 cursor-pointer transition-colors',
                    idx === focusedLine && 'ring-1 ring-primary/50 ring-inset bg-muted/20'
                  )}
                  onClick={() => setFocusedLine(idx)}
                >
                  {/* Line number */}
                  <span className="w-12 px-2 text-right text-muted-foreground/50 select-none border-r border-border/50 bg-card/30 shrink-0">
                    {idx + 1}
                  </span>

                  {/* Content with syntax highlighting */}
                  <div className="flex-1 px-2 min-w-0 overflow-hidden whitespace-pre-wrap break-all [&_*]:!whitespace-pre-wrap">
                    <SyntaxHighlighter
                      language={language}
                      style={vscDarkPlus}
                      customStyle={{
                        margin: 0,
                        padding: 0,
                        background: 'transparent',
                        fontSize: 'inherit',
                        lineHeight: 'inherit',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                      codeTagProps={{
                        style: {
                          fontFamily: 'inherit',
                        }
                      }}
                      PreTag="span"
                      CodeTag="span"
                    >
                      {line || ' '}
                    </SyntaxHighlighter>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Footer with line info */}
      <div className="px-3 py-1 border-t border-border bg-card text-xs font-mono text-muted-foreground flex items-center justify-between shrink-0">
        <span>
          {lines.length > 0 && content && (
            <>Line {focusedLine + 1} of {lines.length}</>
          )}
        </span>
        <span className="text-[10px] opacity-60">
          Press <kbd className="px-1 bg-secondary rounded">?</kbd> for help
        </span>
      </div>
    </div>
  )
}
