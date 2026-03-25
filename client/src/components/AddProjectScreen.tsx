import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import {
  FolderPlus,
  X,
  Loader2,
  Check,
  FolderOpen,
  GitBranch,
  ChevronRight,
  Home,
  ArrowUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface DirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  isGitRepo: boolean
}

interface BrowseResult {
  currentPath: string
  parentPath: string | null
  entries: DirectoryEntry[]
  error?: string
}

interface PathValidation {
  path: string
  exists: boolean
  isDirectory: boolean
  isGitRepo: boolean
}

type ValidationStatus = 'idle' | 'checking' | 'validated'

export function AddProjectScreen() {
  const { closeAddProject, fetchData, addProject } = useAppStore()

  // Animation state
  const [isVisible, setIsVisible] = useState(false)

  // Form state
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [showHidden, setShowHidden] = useState(false)

  // Validation state
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('idle')
  const [validation, setValidation] = useState<PathValidation | null>(null)

  // Browser state
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null)
  const [browseLoading, setBrowseLoading] = useState(true)
  const [browseError, setBrowseError] = useState<string | null>(null)

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Abort controller for validation requests
  const validationAbortRef = useRef<AbortController | null>(null)

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10)
    return () => clearTimeout(timer)
  }, [])

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsVisible(false)
    setTimeout(closeAddProject, 200)
  }, [closeAddProject])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
      // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) to submit
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (validation?.exists && validation?.isGitRepo && !submitting) {
          e.preventDefault()
          handleSubmit()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose, validation, submitting])

  // Initial browse - load home directory
  useEffect(() => {
    browseTo('~')
  }, [])

  // Re-browse when showHidden changes
  useEffect(() => {
    if (browseResult?.currentPath) {
      browseTo(browseResult.currentPath)
    }
  }, [showHidden])

  // Bi-directional sync: when path input is validated as a directory, sync browser
  const lastSyncedPath = useRef<string | null>(null)
  useEffect(() => {
    if (
      validationStatus === 'validated' &&
      validation?.exists &&
      validation?.isDirectory &&
      validation.path !== lastSyncedPath.current &&
      validation.path !== browseResult?.currentPath
    ) {
      lastSyncedPath.current = validation.path
      browseTo(validation.path)
    }
  }, [validationStatus, validation, browseResult?.currentPath])

  // Debounced validation on path input
  useEffect(() => {
    if (!path) {
      setValidationStatus('idle')
      setValidation(null)
      return
    }

    // Cancel previous request
    if (validationAbortRef.current) {
      validationAbortRef.current.abort()
    }

    setValidationStatus('checking')

    const timer = setTimeout(async () => {
      validationAbortRef.current = new AbortController()

      try {
        const res = await apiFetch(`/api/validate-path?path=${encodeURIComponent(path)}`, {
          signal: validationAbortRef.current.signal,
        })

        if (res.ok) {
          const data: PathValidation = await res.json()
          setValidation(data)
          setValidationStatus('validated')
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        console.error('Validation error:', err)
      }
    }, 300)

    return () => {
      clearTimeout(timer)
      if (validationAbortRef.current) {
        validationAbortRef.current.abort()
      }
    }
  }, [path])

  // Browse to a directory
  const browseTo = async (targetPath: string) => {
    setBrowseLoading(true)
    setBrowseError(null)

    try {
      const params = new URLSearchParams({
        path: targetPath,
        showHidden: showHidden.toString(),
      })

      const res = await apiFetch(`/api/browse?${params}`)

      if (res.ok) {
        const data: BrowseResult = await res.json()
        if (data.error) {
          setBrowseError(data.error)
        } else {
          setBrowseResult(data)
          setBrowseError(null)
        }
      } else {
        setBrowseError('Failed to browse directory')
      }
    } catch (err) {
      setBrowseError('Failed to browse directory')
    } finally {
      setBrowseLoading(false)
    }
  }

  // Handle directory click - navigate into it
  const handleDirectoryClick = (entry: DirectoryEntry) => {
    browseTo(entry.path)
  }

  // Handle directory double-click or select - set as path
  const handleSelectDirectory = (entry: DirectoryEntry) => {
    setPath(entry.path)
  }

  // Handle parent directory navigation
  const handleGoUp = () => {
    if (browseResult?.parentPath) {
      browseTo(browseResult.parentPath)
    }
  }

  // Handle home directory navigation
  const handleGoHome = () => {
    browseTo('~')
  }

  // Handle path input change - sync browser if valid
  const handlePathChange = (newPath: string) => {
    setPath(newPath)
    setError(null)
  }

  // Handle form submission
  const handleSubmit = async () => {
    if (!validation?.exists || !validation?.isGitRepo) return

    setSubmitting(true)
    setError(null)

    try {
      const success = await addProject(validation.path, name || undefined)
      if (success) {
        fetchData()
        handleClose()
      } else {
        setError('Failed to add project. Make sure the path is a valid git repository.')
      }
    } catch (e) {
      setError('Failed to add project. Check your connection.')
    } finally {
      setSubmitting(false)
    }
  }

  // Parse path into breadcrumb segments
  const getBreadcrumbs = (fullPath: string) => {
    if (!fullPath) return []
    const segments = fullPath.split('/').filter(Boolean)
    const result: { name: string; path: string }[] = []

    segments.forEach((segment, index) => {
      result.push({
        name: segment,
        path: '/' + segments.slice(0, index + 1).join('/'),
      })
    })

    return result
  }

  const canSubmit = validation?.exists && validation?.isGitRepo && !submitting

  // State to track if current browsed directory is a git repo (for "Use Current Folder")
  const [currentDirValidation, setCurrentDirValidation] = useState<{
    path: string
    isGitRepo: boolean
  } | null>(null)

  // Validate current browsed directory for "Use Current Folder"
  useEffect(() => {
    if (!browseResult?.currentPath) {
      setCurrentDirValidation(null)
      return
    }

    // Quick check via API
    const checkCurrentDir = async () => {
      try {
        const res = await apiFetch(
          `/api/validate-path?path=${encodeURIComponent(browseResult.currentPath)}`,
        )
        if (res.ok) {
          const data: PathValidation = await res.json()
          setCurrentDirValidation({
            path: browseResult.currentPath,
            isGitRepo: data.isGitRepo,
          })
        }
      } catch {
        // Ignore errors
      }
    }

    checkCurrentDir()
  }, [browseResult?.currentPath])

  // Handle "Use Current Folder"
  const handleUseCurrentFolder = () => {
    if (browseResult?.currentPath) {
      setPath(browseResult.currentPath)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]',
          'transition-opacity duration-300',
          isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={handleClose}
      />

      {/* Centered panel */}
      <div
        className={cn(
          'fixed inset-0 z-50 flex items-center justify-center p-4',
          'transition-opacity duration-300',
          isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        <div
          className={cn(
            'w-full max-w-[900px] h-[min(600px,80vh)] bg-background rounded-lg border border-border shadow-xl flex flex-col overflow-hidden',
            'transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          )}
        >
          {/* Header */}
          <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-sidebar shrink-0">
            <div className="flex items-center gap-2 text-foreground">
              <FolderPlus className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm">Add Project</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </header>

          {/* Main content - side by side */}
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left pane - Form (40%) */}
            <div className="md:w-2/5 border-b md:border-b-0 md:border-r border-border p-4 flex flex-col shrink-0">
              <div className="space-y-4 flex-1">
                {/* Path input */}
                <div className="space-y-2">
                  <Label htmlFor="path">Project Path</Label>
                  <div className="relative">
                    <Input
                      id="path"
                      value={path}
                      onChange={(e) => handlePathChange(e.target.value)}
                      placeholder="/path/to/your/project"
                      className="pr-16 font-mono text-sm"
                      autoFocus
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      {validationStatus === 'checking' && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {validationStatus === 'validated' && validation && (
                        <>
                          {validation.exists ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <X className="h-4 w-4 text-destructive" />
                          )}
                          <GitBranch
                            className={cn(
                              'h-4 w-4',
                              validation.isGitRepo
                                ? 'text-green-500'
                                : 'text-muted-foreground/40'
                            )}
                          />
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Validation status - compact inline */}
                {validationStatus === 'validated' && validation && (
                  <p
                    className={cn(
                      'text-xs',
                      !validation.exists && 'text-destructive',
                      validation.exists && !validation.isDirectory && 'text-destructive',
                      validation.exists && validation.isDirectory && !validation.isGitRepo && 'text-yellow-500',
                      validation.exists && validation.isGitRepo && 'text-green-500'
                    )}
                  >
                    {!validation.exists && 'Path does not exist'}
                    {validation.exists && !validation.isDirectory && 'Path is not a directory'}
                    {validation.exists && validation.isDirectory && !validation.isGitRepo && 'Not a git repository'}
                    {validation.exists && validation.isGitRepo && '✓ Valid git repository'}
                  </p>
                )}

                {/* Project Name input */}
                <div className="space-y-2">
                  <Label htmlFor="name">Project Name (optional)</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Defaults to folder name"
                    className="text-sm"
                  />
                </div>

                {/* Error message */}
                {error && (
                  <div className="text-sm text-destructive">{error}</div>
                )}
              </div>

              {/* Submit button - in left pane */}
              <div className="pt-4 mt-auto space-y-2">
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="w-full"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add Project'
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  <kbd className="px-1 py-0.5 bg-muted rounded text-xs font-mono">Esc</kbd> to close
                  {canSubmit && (
                    <> · <kbd className="px-1 py-0.5 bg-muted rounded text-xs font-mono">⌘↵</kbd> to add</>
                  )}
                </p>
              </div>
            </div>

            {/* Right pane - Browser (60%) */}
            <div className="flex-1 flex flex-col overflow-hidden md:w-3/5">
              {/* Browser header */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleGoHome}
                  className="h-7 w-7"
                  title="Go to home directory"
                >
                  <Home className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleGoUp}
                  disabled={!browseResult?.parentPath}
                  className="h-7 w-7"
                  title="Go up"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>

                {/* Breadcrumbs */}
                <div className="flex items-center gap-1 overflow-x-auto text-sm flex-1 min-w-0">
                  <button
                    onClick={() => browseTo('/')}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    /
                  </button>
                  {browseResult && getBreadcrumbs(browseResult.currentPath).map((crumb, index, arr) => (
                    <div key={crumb.path} className="flex items-center shrink-0">
                      <ChevronRight className="h-3 w-3 text-muted-foreground mx-0.5" />
                      <button
                        onClick={() => browseTo(crumb.path)}
                        className={cn(
                          'hover:text-foreground truncate max-w-24',
                          index === arr.length - 1
                            ? 'text-foreground font-medium'
                            : 'text-muted-foreground'
                        )}
                      >
                        {crumb.name}
                      </button>
                    </div>
                  ))}
                </div>

                {/* Show hidden toggle */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Checkbox
                    id="showHidden"
                    checked={showHidden}
                    onCheckedChange={(checked) => setShowHidden(checked === true)}
                    className="h-3.5 w-3.5"
                  />
                  <Label htmlFor="showHidden" className="text-xs cursor-pointer">
                    Hidden
                  </Label>
                </div>
              </div>

              {/* Directory listing */}
              <ScrollArea className="flex-1">
                <div className="p-2">
                  {browseLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : browseError ? (
                    <div className="text-center py-8 text-destructive text-sm">
                      {browseError}
                    </div>
                  ) : browseResult?.entries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No directories found
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {browseResult?.entries.map((entry) => (
                        <button
                          key={entry.path}
                          onClick={() => handleDirectoryClick(entry)}
                          onDoubleClick={() => handleSelectDirectory(entry)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left',
                            'hover:bg-muted/50 transition-colors',
                            'group'
                          )}
                        >
                          {entry.isGitRepo ? (
                            <GitBranch className="h-4 w-4 text-green-500 shrink-0" />
                          ) : (
                            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="truncate flex-1 text-sm">{entry.name}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSelectDirectory(entry)
                            }}
                            className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          >
                            Select
                          </Button>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* "Use Current Folder" button - appears when current dir is git repo */}
              {currentDirValidation?.isGitRepo && browseResult?.currentPath && (
                <div className="p-2 border-t border-border bg-muted/20 shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleUseCurrentFolder}
                    className="w-full text-xs"
                  >
                    <GitBranch className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                    Use Current Folder
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
