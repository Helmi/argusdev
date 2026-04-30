import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { useAppStore } from '@/lib/store'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ProjectConfig, TdPromptTemplate } from '@/lib/types'
import { CheckCircle2, XCircle, Play, Save, RefreshCw, Trash2, Plus, Code2, FolderGit2, ChevronRight, Check, Globe, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DEFAULT_TD_WORK_BRANCH_TEMPLATE,
  renderTdBranchTemplate,
} from '@/lib/tdBranchTemplate'
import { PromptTemplateVariableLegend } from './PromptTemplateVariableLegend'

export function SettingsProject() {
  const {
    projects,
    settingsProjectPath,
    tdStatus,
    config,
    agents,
    projectConfig,
    projectConfigPath,
    fetchProjectConfig,
    saveProjectConfig,
    initializeTdProject,
    fetchTdPrompts,
    saveTdPrompt,
    deleteTdPrompt,
  } = useAppStore()

  const [selectedPath, setSelectedPath] = useState<string>(
    settingsProjectPath ?? projects.find(p => p.isValid !== false)?.path ?? '',
  )

  const [localConfig, setLocalConfig] = useState<ProjectConfig>({})
  const [rawJson, setRawJson] = useState('{}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [savedConfig, setSavedConfig] = useState(false)

  const [allPrompts, setAllPrompts] = useState<TdPromptTemplate[]>([])
  const [effectivePrompts, setEffectivePrompts] = useState<TdPromptTemplate[]>([])
  const [selectedPromptName, setSelectedPromptName] = useState('')
  const [selectedPromptSource, setSelectedPromptSource] = useState<'global' | 'project' | 'new'>('new')
  const [promptName, setPromptName] = useState('')
  const [promptContent, setPromptContent] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [showRawJson, setShowRawJson] = useState(false)

  const projectState = tdStatus?.projectState
  const availability = tdStatus?.availability
  const refreshPromptData = async () => {
    const [all, effective] = await Promise.all([
      fetchTdPrompts('all'),
      fetchTdPrompts('effective'),
    ])
    setAllPrompts(all)
    setEffectivePrompts(effective)
  }

  useEffect(() => {
    if (!selectedPath) return
    fetchProjectConfig(selectedPath)
    refreshPromptData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath])

  useEffect(() => {
    const cfg = projectConfig || {}
    setLocalConfig(cfg)
    setRawJson(JSON.stringify(cfg, null, 2))
  }, [projectConfig])

  const selectPrompt = async (name: string, source: 'global' | 'project') => {
    setSelectedPromptName(name)
    setSelectedPromptSource(source)
    setPromptName(name)
    try {
      const res = await apiFetch(`/api/td/prompts/${encodeURIComponent(name)}?scope=${source}`)
      const data = await res.json()
      setPromptContent(data.template?.content || '')
    } catch {
      setPromptContent('')
    }
  }

  const validProjects = projects.filter(p => p.isValid !== false)
  const enabledAgents = agents.filter(agent => agent.enabled !== false)

  if (!selectedPath) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium mb-1">Project Settings</h3>
          <p className="text-xs text-muted-foreground">
            Select a project to configure project-level settings.
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground">Project</Label>
          <Select onValueChange={(path) => setSelectedPath(path)}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select a project..." />
            </SelectTrigger>
            <SelectContent>
              {validProjects.map((p) => (
                <SelectItem key={p.path} value={p.path}>
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {p.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {validProjects.length === 0 && (
            <p className="text-xs text-muted-foreground">No projects registered yet. Add a project from the sidebar first.</p>
          )}
        </div>
      </div>
    )
  }

  const updateConfig = (nextConfig: ProjectConfig) => {
    setLocalConfig(nextConfig)
    setRawJson(JSON.stringify(nextConfig, null, 2))
  }

  const setTdEnabled = (enabled: boolean) => {
    updateConfig({
      ...localConfig,
      td: {
        ...localConfig.td,
        enabled,
      },
    })
  }

  const setTdAutoStart = (autoStart: boolean) => {
    updateConfig({
      ...localConfig,
      td: {
        ...localConfig.td,
        autoStart,
      },
    })
  }

  const setDefaultPrompt = (defaultPrompt: string) => {
    updateConfig({
      ...localConfig,
      td: {
        ...localConfig.td,
        defaultPrompt: defaultPrompt || undefined,
      },
    })
  }

  const setHook = (field: 'setup' | 'teardown', value: string) => {
    updateConfig({
      ...localConfig,
      scripts: {
        ...localConfig.scripts,
        [field]: value,
      },
    })
  }

  const setAgentDefault = (agentId: string) => {
    updateConfig({
      ...localConfig,
      agentDefaults: {
        ...localConfig.agentDefaults,
        agentId: agentId || undefined,
      },
    })
  }

  const handleSaveConfig = async () => {
    setSavingConfig(true)
    await saveProjectConfig(localConfig, selectedPath)
    setSavingConfig(false)
    setSavedConfig(true)
    setTimeout(() => setSavedConfig(false), 2000)
  }

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(rawJson) as ProjectConfig
      setJsonError(null)
      setLocalConfig(parsed)
    } catch (err) {
      setJsonError(String(err))
    }
  }

  const handleInitTd = async () => {
    const ok = await initializeTdProject()
    if (ok) {
      await refreshPromptData()
    }
  }

  const handleNewPrompt = () => {
    setSelectedPromptName('')
    setSelectedPromptSource('new')
    setPromptName('')
    setPromptContent('')
  }

  const handleSavePrompt = async () => {
    if (!promptName.trim()) return
    setSavingPrompt(true)
    const ok = await saveTdPrompt(promptName.trim(), promptContent, 'project')
    if (ok) {
      await refreshPromptData()
      setSelectedPromptName(promptName.trim())
      setSelectedPromptSource('project')
    }
    setSavingPrompt(false)
  }

  const handleDeletePrompt = async () => {
    if (!selectedPromptName || selectedPromptSource !== 'project') return
    setSavingPrompt(true)
    const ok = await deleteTdPrompt(selectedPromptName, 'project')
    if (ok) {
      setSelectedPromptName('')
      setSelectedPromptSource('new')
      setPromptName('')
      setPromptContent('')
      await refreshPromptData()
    }
    setSavingPrompt(false)
  }

  const tdEnabled = localConfig.td?.enabled !== false
  const tdAutoStart = localConfig.td?.autoStart !== false
  const projectBranchTemplate = localConfig.quickStart?.work?.branchTemplate || ''
  const globalBranchTemplate = config.quickStart?.work?.branchTemplate || ''
  const effectiveProjectBranchTemplate = projectBranchTemplate.trim()
    || globalBranchTemplate.trim()
    || DEFAULT_TD_WORK_BRANCH_TEMPLATE
  const previewProjectBranch = renderTdBranchTemplate(effectiveProjectBranchTemplate, {
    id: 'td-ab12cd',
    title: 'Reconcile user agents config with adapter registry on startup',
    type: 'feature',
  })

  const setProjectBranchTemplate = (value: string) => {
    const trimmed = value.trim()
    const quickStart = { ...(localConfig.quickStart || {}) }
    const work = { ...(quickStart.work || {}) }

    if (trimmed) {
      work.branchTemplate = trimmed
      quickStart.work = work
    } else {
      delete work.branchTemplate
      if (Object.keys(work).length > 0) quickStart.work = work
      else delete quickStart.work
    }

    updateConfig({
      ...localConfig,
      quickStart: Object.keys(quickStart).length > 0 ? quickStart : undefined,
    })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium mb-1">Project Settings</h3>
          <p className="text-xs text-muted-foreground">
            Configure project-level hooks, prompts, and agent defaults.
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Project</Label>
          <Select value={selectedPath} onValueChange={(path) => setSelectedPath(path)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {validProjects.map((p) => (
                <SelectItem key={p.path} value={p.path}>
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {p.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {projectConfigPath && (
          <p className="text-xs text-muted-foreground">
            Config: <span className="font-mono">{projectConfigPath}</span>
          </p>
        )}
      </div>

      <div className="space-y-3">
        <Label className="text-muted-foreground">TD Project Status</Label>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {projectState?.initialized ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-muted-foreground" />
            )}
            <span>{projectState?.initialized ? 'td initialized' : 'td not initialized'}</span>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="project-td-enabled"
              checked={tdEnabled}
              onCheckedChange={(checked) => setTdEnabled(checked === true)}
            />
            <label htmlFor="project-td-enabled" className="cursor-pointer">Enable td integration for this project</label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="project-td-autostart"
              checked={tdAutoStart}
              onCheckedChange={(checked) => setTdAutoStart(checked === true)}
            />
            <label htmlFor="project-td-autostart" className="cursor-pointer">Auto-start linked td task for new sessions</label>
          </div>

          {availability?.binaryAvailable && !projectState?.initialized && (
            <Button variant="outline" size="sm" onClick={handleInitTd}>
              <Play className="h-3.5 w-3.5 mr-1" />
              Initialize td
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <Label className="text-muted-foreground">Defaults and Hooks</Label>

        <div className="space-y-2">
          <Label htmlFor="project-work-branch-template" className="text-xs text-muted-foreground">
            TD Work Branch Template Override
          </Label>
          <Input
            id="project-work-branch-template"
            value={projectBranchTemplate}
            onChange={(e) => setProjectBranchTemplate(e.target.value)}
            className="h-8 font-mono"
            placeholder={globalBranchTemplate || DEFAULT_TD_WORK_BRANCH_TEMPLATE}
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to inherit global. Variables: <code>{'{{task.id}}'}</code>,{' '}
            <code>{'{{task.type-prefix}}'}</code>, <code>{'{{task.title}}'}</code>,{' '}
            <code>{'{{task.title-short-slug}}'}</code>, <code>{'{{task.title-slug}}'}</code>.
            Aliases: <code>{'{{task.type_prefix}}'}</code>,{' '}
            <code>{'{{task.title_short_slug}}'}</code>, <code>{'{{task.title_slug}}'}</code>.
          </p>
          <p className="text-xs text-muted-foreground">
            Effective preview: <span className="font-mono">{previewProjectBranch}</span>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-default-prompt" className="text-xs text-muted-foreground">Default Prompt Template</Label>
          <Select
            value={localConfig.td?.defaultPrompt || '__inherit__'}
            onValueChange={(v) => setDefaultPrompt(v === '__inherit__' ? '' : v)}
          >
            <SelectTrigger id="project-default-prompt" className="h-8">
              <SelectValue placeholder="Inherit global default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit__">Inherit global default</SelectItem>
              {effectivePrompts.map((prompt) => (
                <SelectItem key={prompt.name} value={prompt.name}>
                  {prompt.name} {prompt.source === 'global' ? '(global)' : '(project)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-agent-default" className="text-xs text-muted-foreground">Default Agent</Label>
          <Select
            value={
              localConfig.agentDefaults?.agentId &&
              enabledAgents.some(agent => agent.id === localConfig.agentDefaults?.agentId)
                ? localConfig.agentDefaults.agentId
                : '__none__'
            }
            onValueChange={(v) => setAgentDefault(v === '__none__' ? '' : v)}
          >
            <SelectTrigger id="project-agent-default" className="h-8">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {enabledAgents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-hook-setup" className="text-xs text-muted-foreground">Setup Hook</Label>
          <Input
            id="project-hook-setup"
            value={localConfig.scripts?.setup || ''}
            onChange={(e) => setHook('setup', e.target.value)}
            className="h-8 font-mono"
            placeholder="npm install && npm run build"
          />
          <p className="text-xs text-muted-foreground">
            Runs after worktree creation. Env: <code className="bg-muted px-1 rounded">$ARGUSDEV_WORKTREE_PATH</code>, <code className="bg-muted px-1 rounded">$ARGUSDEV_WORKTREE_BRANCH</code>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="project-hook-teardown" className="text-xs text-muted-foreground">Teardown Hook</Label>
          <Input
            id="project-hook-teardown"
            value={localConfig.scripts?.teardown || ''}
            onChange={(e) => setHook('teardown', e.target.value)}
            className="h-8 font-mono"
            placeholder="cleanup-script.sh"
          />
          <p className="text-xs text-muted-foreground">
            Runs before worktree deletion. Same env vars as setup hook.
          </p>
        </div>

        <Button
          size="sm"
          onClick={handleSaveConfig}
          disabled={savingConfig || savedConfig}
          className={cn(savedConfig && 'bg-green-600 hover:bg-green-600')}
        >
          {savedConfig ? <Check className="h-3.5 w-3.5 mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          {savingConfig ? 'Saving...' : savedConfig ? 'Saved' : 'Save Project Config'}
        </Button>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground">Prompt Templates</Label>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={refreshPromptData}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleNewPrompt}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Select a template to view or edit. Global templates can be customized as project overrides.
        </p>

        {/* Unified template list */}
        <div className="border border-border rounded-md max-h-56 overflow-y-auto">
          {allPrompts.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">No prompt templates found.</div>
          ) : (
            allPrompts.map((prompt) => {
              const isSelected = selectedPromptName === prompt.name && selectedPromptSource === prompt.source
              return (
                <button
                  key={`${prompt.source}-${prompt.name}`}
                  className={cn(
                    'w-full text-left px-3 py-2 border-b border-border last:border-b-0 text-sm transition-colors',
                    isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  )}
                  onClick={() => selectPrompt(prompt.name, prompt.source as 'global' | 'project')}
                >
                  <div className="flex items-center gap-2">
                    {prompt.source === 'global' ? (
                      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                    )}
                    <span className="truncate flex-1">{prompt.name}</span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded shrink-0',
                      prompt.source === 'project' ? 'bg-blue-500/10 text-blue-500' : 'bg-muted text-muted-foreground',
                      prompt.source === 'global' && prompt.overridden && 'line-through opacity-50'
                    )}>
                      {prompt.source === 'project' && prompt.overridesGlobal ? 'override' : prompt.source}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Editor area */}
        {(selectedPromptName || selectedPromptSource === 'new') && (
          <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
            {selectedPromptSource === 'global' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded px-2.5 py-2">
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span>Global template — save to create a project override</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="prompt-name" className="text-xs text-muted-foreground">Name</Label>
              <Input
                id="prompt-name"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
                className="h-8"
                placeholder="Prompt template name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-content" className="text-xs text-muted-foreground">Content</Label>
              <textarea
                id="prompt-content"
                value={promptContent}
                onChange={(e) => setPromptContent(e.target.value)}
                className="min-h-36 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Prompt text. Supports variables like {{task.id}}, {{task.title}}, {{task.description}}"
              />
              <PromptTemplateVariableLegend />
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSavePrompt} disabled={!promptName.trim() || savingPrompt}>
                <Save className="h-3.5 w-3.5 mr-1" />
                {selectedPromptSource === 'global' ? 'Save as Override' : 'Save'}
              </Button>
              {selectedPromptSource === 'project' && (
                <Button variant="outline" size="sm" onClick={handleDeletePrompt} disabled={savingPrompt}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <button
          onClick={() => setShowRawJson(!showRawJson)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showRawJson && 'rotate-90')} />
          <Code2 className="h-3.5 w-3.5" />
          Raw Config JSON
        </button>
        {showRawJson && (
          <div className="rounded border border-border bg-muted/20 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              For advanced fields not covered in the structured form.
            </p>
            <textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              className="min-h-48 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
            />
            {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
            <Button size="sm" variant="outline" onClick={handleApplyJson}>
              Apply JSON to Form
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
