import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { AppConfig } from '@/lib/types'

interface SettingsWorktreeHooksProps {
  localConfig: AppConfig
  setLocalConfig: (config: AppConfig) => void
}

export function SettingsWorktreeHooks({ localConfig, setLocalConfig }: SettingsWorktreeHooksProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Worktree Hooks</h3>
        <p className="text-xs text-muted-foreground">
          Shell commands to run on worktree lifecycle events. Chain multiple commands with <code className="bg-muted px-1 rounded">&&</code> or <code className="bg-muted px-1 rounded">;</code>
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="hook-post-creation" className="text-sm">
            Post Creation
          </Label>
          <Input
            id="hook-post-creation"
            value={localConfig.worktreeHooks.postCreation}
            onChange={(e) =>
              setLocalConfig({
                ...localConfig,
                worktreeHooks: { ...localConfig.worktreeHooks, postCreation: e.target.value },
              })
            }
            className="h-9 text-sm font-mono"
            placeholder="npm install && git pull"
          />
          <p className="text-xs text-muted-foreground">
            Runs after a worktree is created. Environment variables: <code className="bg-muted px-1 rounded">$ARGUSDEV_WORKTREE_PATH</code>, <code className="bg-muted px-1 rounded">$ARGUSDEV_WORKTREE_BRANCH</code>, <code className="bg-muted px-1 rounded">$ARGUSDEV_GIT_ROOT</code>
          </p>
        </div>
      </div>
    </div>
  )
}
