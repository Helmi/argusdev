import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { useAppStore } from '@/lib/store'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TdPromptTemplate } from '@/lib/types'
import {
  CheckCircle2,
  XCircle,
  Terminal,
  Plus,
  Save,
  Trash2,
  FileText,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PromptTemplateVariableLegend } from './PromptTemplateVariableLegend'

export function SettingsTd() {
  const { tdStatus, tdStatusLoading, fetchTdPrompts, saveTdPrompt, deleteTdPrompt, config, fetchData } = useAppStore()
  const [prompts, setPrompts] = useState<TdPromptTemplate[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<string>('')
  const [defaultPrompt, setDefaultPrompt] = useState<string>('')
  const [promptName, setPromptName] = useState('')
  const [promptContent, setPromptContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingDefaultPrompt, setSavingDefaultPrompt] = useState(false)
  const [loadingPrompt, setLoadingPrompt] = useState(false)

  const availability = tdStatus?.availability
  const configuredDefaultPrompt = useMemo(() => {
    const raw = config.raw
    if (!raw || typeof raw !== 'object') return ''
    const td = (raw as Record<string, unknown>).td
    if (!td || typeof td !== 'object' || Array.isArray(td)) return ''
    const defaultPromptValue = (td as Record<string, unknown>).defaultPrompt
    return typeof defaultPromptValue === 'string' ? defaultPromptValue.trim() : ''
  }, [config.raw])

  const saveDefaultPrompt = useCallback(async (nextDefaultPrompt: string) => {
    const trimmed = nextDefaultPrompt.trim()
    if (!trimmed) return false

    const raw = config.raw
    const rawTd =
      raw &&
      typeof raw === 'object' &&
      (raw as Record<string, unknown>).td &&
      typeof (raw as Record<string, unknown>).td === 'object' &&
      !Array.isArray((raw as Record<string, unknown>).td)
        ? ((raw as Record<string, unknown>).td as Record<string, unknown>)
        : {}

    setSavingDefaultPrompt(true)
    try {
      const res = await apiFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          td: {
            ...rawTd,
            defaultPrompt: trimmed,
          },
        }),
      })
      if (!res.ok) return false
      setDefaultPrompt(trimmed)
      await fetchData()
      return true
    } catch {
      return false
    } finally {
      setSavingDefaultPrompt(false)
    }
  }, [config.raw, fetchData])

  const refreshPrompts = useCallback(async () => {
    const data = await fetchTdPrompts('global')
    setPrompts(data)
    setSelectedPrompt((prevSelected) => {
      if (data.length === 0) {
        setPromptName('')
        setPromptContent('')
        return ''
      }

      if (!prevSelected || !data.some(p => p.name === prevSelected)) {
        const next = data[0].name
        setPromptName(next)
        return next
      }

      return prevSelected
    })
  }, [fetchTdPrompts])

  useEffect(() => {
    void refreshPrompts()
  }, [refreshPrompts, availability?.binaryAvailable])

  useEffect(() => {
    if (!selectedPrompt) {
      setPromptContent('')
      return
    }

    setLoadingPrompt(true)
    apiFetch(`/api/td/prompts/${encodeURIComponent(selectedPrompt)}?scope=global`)
      .then(res => res.json())
      .then(data => {
        setPromptContent(data.template?.content || '')
        setPromptName(data.template?.name || selectedPrompt)
      })
      .catch(() => setPromptContent(''))
      .finally(() => setLoadingPrompt(false))
  }, [selectedPrompt])

  useEffect(() => {
    if (prompts.length === 0) {
      setDefaultPrompt('')
      return
    }

    if (configuredDefaultPrompt && prompts.some(p => p.name === configuredDefaultPrompt)) {
      setDefaultPrompt(configuredDefaultPrompt)
      return
    }

    const fallback = prompts[0]!.name
    setDefaultPrompt(fallback)
    void saveDefaultPrompt(fallback)
  }, [prompts, configuredDefaultPrompt, saveDefaultPrompt])

  const canSave = useMemo(() => promptName.trim().length > 0, [promptName])

  const handleNew = () => {
    setSelectedPrompt('')
    setPromptName('')
    setPromptContent('')
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const ok = await saveTdPrompt(promptName.trim(), promptContent, 'global')
    if (ok) {
      await refreshPrompts()
      setSelectedPrompt(promptName.trim())
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!selectedPrompt) return
    setSaving(true)
    const ok = await deleteTdPrompt(selectedPrompt, 'global')
    if (ok) {
      const remaining = prompts.filter(p => p.name !== selectedPrompt)
      setSelectedPrompt(remaining[0]?.name || '')
      if (remaining.length === 0) {
        setPromptName('')
        setPromptContent('')
      }
      await refreshPrompts()
    }
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">TD Integration</h3>
        <p className="text-xs text-muted-foreground">
          TD is a lightweight task tracker for agent workflows with per-project `.todos` state.
          {' '}
          <a
            href="https://github.com/marcus/td"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Learn more
          </a>
          .
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-muted-foreground">td Installation</Label>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            {tdStatusLoading ? (
              <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
            ) : availability?.binaryAvailable ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            <span>
              {tdStatusLoading
                ? 'Checking td installation...'
                : `td binary ${availability?.binaryAvailable ? 'installed' : 'not found'}`}
            </span>
            {!tdStatusLoading && availability?.binaryAvailable && availability.version && (
              <span className="text-xs text-muted-foreground font-mono">
                {availability.version}
              </span>
            )}
          </div>

          {availability?.binaryAvailable && availability.binaryPath && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Terminal className="h-3 w-3" />
              <span className="font-mono">{availability.binaryPath}</span>
            </div>
          )}

          {!availability?.binaryAvailable && (
            <div className="rounded border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              <p>Install td to enable task management features:</p>
              <code className="block bg-background rounded px-2 py-1 font-mono text-[11px]">
                go install github.com/marcus/td@latest
              </code>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <div className="space-y-2">
          <Label className="text-muted-foreground">Default Prompt Template</Label>
          {prompts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Create a global prompt template first.</p>
          ) : (
            <Select
              value={defaultPrompt || prompts[0]!.name}
              onValueChange={(value) => void saveDefaultPrompt(value)}
            >
              <SelectTrigger className="h-8" disabled={savingDefaultPrompt}>
                <SelectValue placeholder="Select default prompt" />
              </SelectTrigger>
              <SelectContent>
                {prompts.map((prompt) => (
                  <SelectItem key={prompt.name} value={prompt.name}>
                    {prompt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">
            Used automatically for TD-linked sessions when no prompt is explicitly selected.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground">Global Prompt Templates</Label>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={refreshPrompts}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleNew}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              New
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-3">
          <div className="border border-border rounded-md max-h-64 overflow-y-auto">
            {prompts.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No global prompts found.</div>
            ) : (
              prompts.map((p) => (
                <button
                  key={p.name}
                  className={cn(
                    'w-full text-left px-3 py-2 border-b border-border last:border-b-0 text-sm',
                    selectedPrompt === p.name ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setSelectedPrompt(p.name)}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{p.name}</span>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="global-prompt-name" className="text-xs text-muted-foreground">Name</Label>
            <Input
              id="global-prompt-name"
              value={promptName}
              onChange={(e) => setPromptName(e.target.value)}
              className="h-8 text-sm"
              placeholder="Prompt template name"
            />

            <Label htmlFor="global-prompt-content" className="text-xs text-muted-foreground">Content</Label>
            <textarea
              id="global-prompt-content"
              value={promptContent}
              onChange={(e) => setPromptContent(e.target.value)}
              className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Prompt text. Supports variables like {{task.id}}, {{task.title}}, {{task.description}}"
              disabled={loadingPrompt}
            />
            <PromptTemplateVariableLegend />

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
                <Save className="h-3.5 w-3.5 mr-1" />
                Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={!selectedPrompt || saving}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
