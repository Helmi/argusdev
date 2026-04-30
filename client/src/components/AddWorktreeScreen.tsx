import { useState, useEffect, useCallback, useMemo } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  GitBranch,
  X,
  Loader2,
  Folder,
  Plus,
  AlertTriangle,
} from 'lucide-react'
import { cn, generateWorktreePath as generatePath } from '@/lib/utils'

export function AddWorktreeScreen() {
  const {
    closeAddWorktree,
    addWorktreeProjectPath,
    createWorktree,
    fetchData,
    projects,
    config,
    openAddProject,
  } = useAppStore()

  // Animation state
  const [isVisible, setIsVisible] = useState(false)

  // Determine if project was pre-selected from context menu
  const preselectedProject = addWorktreeProjectPath
    ? projects.find(p => p.path === addWorktreeProjectPath)
    : undefined
  const hasPreselectedProject =
    !!addWorktreeProjectPath && preselectedProject?.isValid !== false

  const [selectedProjectPath, setSelectedProjectPath] = useState<string>('')
  const [baseBranch, setBaseBranch] = useState<string>('main')
  const [branchName, setBranchName] = useState('')
  const [copySessionData, setCopySessionData] = useState(true)
  const [copyClaudeDirectory, setCopyClaudeDirectory] = useState(true)
  const [branches, setBranches] = useState<string[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get the selected project object for display
  const selectedProject = projects.find(p => p.path === selectedProjectPath)

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10)
    return () => clearTimeout(timer)
  }, [])

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsVisible(false)
    setTimeout(closeAddWorktree, 200)
  }, [closeAddWorktree])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose])

  // Initialize project selection
  useEffect(() => {
    if (selectedProjectPath) return

    if (addWorktreeProjectPath) {
      if (projects.length === 0) return

      const project = projects.find(p => p.path === addWorktreeProjectPath)
      if (project?.isValid === false) {
        setError(`Project path is invalid or missing: ${addWorktreeProjectPath}`)
        return
      }
      if (project) {
        setSelectedProjectPath(addWorktreeProjectPath)
        return
      }
    }

    const validProjects = projects.filter(p => p.isValid !== false)
    if (validProjects.length === 1) {
      setSelectedProjectPath(validProjects[0].path)
    }
  }, [addWorktreeProjectPath, projects, selectedProjectPath])

  // Fetch branches when project changes
  useEffect(() => {
    if (!selectedProjectPath) {
      setBranches([])
      return
    }

    setLoadingBranches(true)
    apiFetch(`/api/branches?projectPath=${encodeURIComponent(selectedProjectPath)}`)
      .then(res => res.json())
      .then(data => {
        setBranches(data || [])
        if (data.includes('main')) setBaseBranch('main')
        else if (data.includes('master')) setBaseBranch('master')
        else if (data.length > 0) setBaseBranch(data[0])
      })
      .catch(() => setBranches(['main']))
      .finally(() => setLoadingBranches(false))
  }, [selectedProjectPath])

  // Generate worktree path based on config template and branch name
  const generateWorktreePath = useMemo(() => {
    if (!branchName || !selectedProjectPath) return ''
    return generatePath(selectedProjectPath, branchName, config.worktreePathTemplate)
  }, [branchName, selectedProjectPath, config.worktreePathTemplate])

  const handleSubmit = async () => {
    if (!selectedProjectPath || !baseBranch || !branchName.trim()) return

    setSubmitting(true)
    setError(null)

    try {
      const success = await createWorktree(
        generateWorktreePath,
        branchName.trim(),
        baseBranch,
        copySessionData,
        copyClaudeDirectory,
        selectedProjectPath
      )

      if (success) {
        fetchData()
        handleClose()
      } else {
        setError('Failed to create worktree')
      }
    } catch (e) {
      setError('Failed to create worktree. Check your connection.')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    selectedProjectPath &&
    selectedProject?.isValid !== false &&
    baseBranch &&
    branchName.trim() &&
    !submitting

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]',
          'transition-opacity duration-300',
          isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={handleClose}
      />

      {/* Main panel */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-background flex flex-col',
          'transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          isVisible ? 'translate-x-0 opacity-100' : 'translate-x-[20%] opacity-0'
        )}
      >
        {/* Header */}
        <header className="flex items-center justify-between h-12 px-4 border-b border-border bg-sidebar shrink-0">
          <div className="flex items-center gap-2 text-foreground">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">New Worktree</span>
            {hasPreselectedProject && selectedProject && (
              <span className="text-muted-foreground text-sm">
                in {selectedProject.name}
              </span>
            )}
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

        {/* Main content */}
        <ScrollArea className="flex-1">
          <div className="max-w-lg mx-auto p-6 space-y-6">
            {/* Empty state - no projects exist */}
            {projects.length === 0 && !hasPreselectedProject ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Folder className="h-16 w-16 text-muted-foreground/50 mb-6" />
                <p className="text-muted-foreground mb-6">
                  You need a project before creating a worktree.
                </p>
                <Button
                  onClick={() => {
                    handleClose()
                    setTimeout(openAddProject, 250)
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Project
                </Button>
              </div>
            ) : (
              <>
                {/* Project selection - hide if pre-selected from context menu */}
                {!hasPreselectedProject && (
                  <div className="space-y-2">
                    <Label>Project</Label>
                    <Select
                      value={selectedProjectPath}
                      onValueChange={(v) => {
                        setSelectedProjectPath(v)
                        setError(null)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((project) => {
                          const isInvalid = project.isValid === false
                          return (
                            <SelectItem
                              key={project.path}
                              value={project.path}
                              disabled={isInvalid}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <Folder className="h-3 w-3 shrink-0" />
                                <span className="truncate">{project.name}</span>
                                {isInvalid && (
                                  <span className="flex items-center gap-1 text-xs text-yellow-600 shrink-0">
                                    <AlertTriangle className="h-3 w-3" />
                                    invalid
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Base branch selection */}
                <div className="space-y-2">
                  <Label>Base Branch</Label>
                  <Select
                    value={baseBranch}
                    onValueChange={setBaseBranch}
                    disabled={!selectedProjectPath || loadingBranches}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingBranches ? 'Loading...' : 'Select base branch'} />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch} value={branch}>
                          <div className="flex items-center gap-2">
                            <GitBranch className="h-3 w-3" />
                            {branch}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    New worktree will branch off from this branch
                  </p>
                </div>

                {/* New branch name */}
                <div className="space-y-2">
                  <Label htmlFor="branch-name">New Branch Name</Label>
                  <Input
                    id="branch-name"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="e.g., feature/new-feature"
                    className="font-mono text-sm"
                    disabled={!baseBranch}
                    autoFocus
                  />
                </div>

                {/* Generated path preview */}
                {branchName && generateWorktreePath && (
                  <div className="space-y-1">
                    <Label className="text-muted-foreground">Worktree Path</Label>
                    <div className="text-xs font-mono bg-muted/50 rounded px-3 py-2 text-muted-foreground break-all">
                      {generateWorktreePath}
                    </div>
                  </div>
                )}

                {/* Copy options */}
                <div className="space-y-4 pt-4 border-t border-border">
                  <Label className="text-muted-foreground">Copy Options</Label>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="copy-session"
                        checked={copySessionData}
                        onCheckedChange={(checked) => setCopySessionData(checked === true)}
                      />
                      <Label htmlFor="copy-session" className="text-sm font-normal cursor-pointer">
                        Copy session data
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="copy-claude"
                        checked={copyClaudeDirectory}
                        onCheckedChange={(checked) => setCopyClaudeDirectory(checked === true)}
                      />
                      <Label htmlFor="copy-claude" className="text-sm font-normal cursor-pointer">
                        Copy .claude directory
                      </Label>
                    </div>
                  </div>
                </div>

                {/* Error message */}
                {error && (
                  <div className="text-sm text-destructive">{error}</div>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-sidebar shrink-0">
          <span className="text-xs text-muted-foreground mr-auto hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Esc</kbd> to close
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={submitting}
            className="h-8 px-3 text-sm"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-8 px-4 text-sm"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Worktree'
            )}
          </Button>
        </footer>
      </div>
    </>
  )
}
