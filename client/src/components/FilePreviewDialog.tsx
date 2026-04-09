import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '@/lib/store'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, FileWarning, FileX } from 'lucide-react'
import { getLanguage, isMarkdownFile } from '@/lib/fileUtils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Preprocess markdown to handle YAML frontmatter and custom XML-like tags.
// Tags starting with uppercase (e.g. <Purpose>, <Good>) cause react-markdown
// to enter HTML block mode, breaking code fence parsing. We convert them to
// backtick-wrapped inline code so they render as styled tag badges instead.
// Tags on their own line get blank lines around them to preserve block separation.
function preprocessMarkdown(raw: string): string {
  let text = raw
  // Strip YAML frontmatter
  text = text.replace(/^---\n[\s\S]*?\n---\n*/, '')
  // Tags alone on a line → block-level (surrounded by blank lines)
  text = text.replace(/^([ \t]*)<(\/?[A-Z][A-Za-z0-9_-]*)>([ \t]*)$/gm, '\n`<$2>`\n')
  // Remaining inline tags
  text = text.replace(/<(\/?[A-Z][A-Za-z0-9_-]*)>/g, '`<$1>`')
  return text
}

// Detect if inline code content is a custom XML tag
function isXmlTag(text: string): boolean {
  return /^<\/?[A-Z][A-Za-z0-9_-]*>$/.test(text)
}

export function FilePreviewDialog() {
  const { previewFile, closeFilePreview } = useAppStore()

  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isBinary, setIsBinary] = useState(false)
  const [tooLarge, setTooLarge] = useState(false)
  const [fileSize, setFileSize] = useState(0)

  const worktreePath = previewFile?.worktreePath
  const filePath = previewFile?.filePath

  useEffect(() => {
    if (!worktreePath || !filePath) return

    const fetchFile = async () => {
      setLoading(true)
      setError(null)
      setIsBinary(false)
      setTooLarge(false)
      try {
        const response = await fetch(
          `/api/worktree/file?path=${encodeURIComponent(worktreePath)}&file=${encodeURIComponent(filePath)}`,
        )
        if (!response.ok) throw new Error('Failed to fetch file')
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

  const markdownContent = useMemo(() => {
    if (!filePath) return content
    return isMarkdownFile(filePath.split('/').pop() || '') ? preprocessMarkdown(content) : content
  }, [content, filePath])

  if (!previewFile || !filePath) return null

  const fileName = filePath.split('/').pop() || filePath
  const dirPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
  const language = getLanguage(fileName)
  const isMarkdown = isMarkdownFile(fileName)

  return (
    <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) closeFilePreview() }}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b border-border shrink-0">
          <DialogTitle className="font-mono text-sm flex items-center gap-2">
            <span className="text-muted-foreground">{dirPath && `${dirPath}/`}</span>
            <span>{fileName}</span>
            {!loading && !error && (
              <span className="text-xs text-muted-foreground font-normal ml-2">
                {formatSize(fileSize)} · {isMarkdown ? 'markdown' : language}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="font-mono text-sm">Loading...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64 text-destructive">
              <span className="font-mono text-sm">{error}</span>
            </div>
          ) : isBinary ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
              <FileWarning className="h-8 w-8" />
              <span className="font-mono text-sm">Binary file</span>
            </div>
          ) : tooLarge ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
              <FileX className="h-8 w-8" />
              <span className="font-mono text-sm">File too large ({formatSize(fileSize)})</span>
            </div>
          ) : (
            <ScrollArea className="h-[calc(80vh-4rem)]">
              {isMarkdown ? (
                <div className="px-6 py-4" style={{ fontFamily: "'Inter', sans-serif" }}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => (
                        <h1 className="text-xl font-bold mb-3 mt-5 first:mt-0 text-foreground border-b border-border pb-2">
                          {children}
                        </h1>
                      ),
                      h2: ({ children }) => (
                        <h2 className="text-lg font-semibold mb-2 mt-4 text-foreground border-b border-border pb-1">
                          {children}
                        </h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-base font-semibold mb-2 mt-3 text-foreground">{children}</h3>
                      ),
                      h4: ({ children }) => (
                        <h4 className="text-sm font-semibold mb-1 mt-2 text-foreground">{children}</h4>
                      ),
                      p: ({ children }) => <p className="mb-1.5 text-sm text-foreground leading-relaxed">{children}</p>,
                      ul: ({ children }) => <ul className="mb-1.5 ml-4 list-disc text-sm text-foreground">{children}</ul>,
                      ol: ({ children }) => (
                        <ol className="mb-1.5 ml-4 list-decimal text-sm text-foreground">{children}</ol>
                      ),
                      li: ({ children }) => <li className="mb-0.5 leading-relaxed">{children}</li>,
                      blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-muted-foreground/30 pl-4 my-3 text-muted-foreground italic">
                          {children}
                        </blockquote>
                      ),
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          className="text-blue-400 hover:text-blue-300 underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ),
                      code: ({ className, children }) => {
                        const langMatch = className?.match(/language-(\w+)/)
                        const text = String(children)
                        // Custom XML tags: render with theme-aware accent color
                        if (isXmlTag(text)) {
                          return (
                            <code className="-mx-0.5 px-0.5 -my-px py-px rounded font-mono text-xs bg-primary/10 text-primary">
                              {text}
                            </code>
                          )
                        }
                        // Block code: has a language class OR content contains newlines
                        const isBlock = !!langMatch || text.includes('\n')
                        if (isBlock) {
                          return (
                            <SyntaxHighlighter
                              language={langMatch?.[1] || 'text'}
                              style={vscDarkPlus}
                              customStyle={{
                                margin: '0.75rem 0',
                                borderRadius: '0.375rem',
                                fontSize: 'inherit',
                              }}
                            >
                              {text.replace(/\n$/, '')}
                            </SyntaxHighlighter>
                          )
                        }
                        return (
                          <code className="bg-muted -mx-0.5 px-0.5 -my-px py-px rounded font-mono text-xs">{children}</code>
                        )
                      },
                      pre: ({ children }) => <>{children}</>,
                      hr: () => <hr className="my-4 border-border" />,
                      table: ({ children }) => (
                        <div className="overflow-x-auto my-3">
                          <table className="text-sm border-collapse w-full">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
                      th: ({ children }) => (
                        <th className="text-left px-3 py-1.5 font-semibold text-foreground">{children}</th>
                      ),
                      td: ({ children }) => (
                        <td className="px-3 py-1.5 border-b border-border/50 text-foreground">{children}</td>
                      ),
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                    }}
                  >
                    {markdownContent}
                  </ReactMarkdown>
                </div>
              ) : (
                <SyntaxHighlighter
                  language={language}
                  style={vscDarkPlus}
                  showLineNumbers
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    lineHeight: '1.5',
                  }}
                  lineNumberStyle={{
                    minWidth: '3em',
                    paddingRight: '1em',
                    color: 'rgba(255,255,255,0.2)',
                    userSelect: 'none',
                  }}
                >
                  {content}
                </SyntaxHighlighter>
              )}
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
