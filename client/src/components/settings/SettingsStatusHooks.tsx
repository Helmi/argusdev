import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { AppConfig } from '@/lib/types'

interface SettingsStatusHooksProps {
  localConfig: AppConfig
  setLocalConfig: (config: AppConfig) => void
}

export function SettingsStatusHooks({ localConfig, setLocalConfig }: SettingsStatusHooksProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Status Hooks</h3>
        <p className="text-xs text-muted-foreground">
          Shell commands to run when session status changes. Available env vars: <code className="bg-muted px-1 rounded">$ARGUSDEV_SESSION_ID</code>, <code className="bg-muted px-1 rounded">$ARGUSDEV_OLD_STATE</code>, <code className="bg-muted px-1 rounded">$ARGUSDEV_NEW_STATE</code>, <code className="bg-muted px-1 rounded">$ARGUSDEV_WORKTREE_PATH</code>
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="hook-idle" className="text-sm">
            On Idle
          </Label>
          <Input
            id="hook-idle"
            value={localConfig.statusHooks.onIdle}
            onChange={(e) =>
              setLocalConfig({
                ...localConfig,
                statusHooks: { ...localConfig.statusHooks, onIdle: e.target.value },
              })
            }
            className="h-9 text-sm font-mono"
            placeholder="echo 'Session idle'"
          />
          <p className="text-xs text-muted-foreground">
            Runs when a session becomes idle (finished processing)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="hook-busy" className="text-sm">
            On Busy
          </Label>
          <Input
            id="hook-busy"
            value={localConfig.statusHooks.onBusy}
            onChange={(e) =>
              setLocalConfig({
                ...localConfig,
                statusHooks: { ...localConfig.statusHooks, onBusy: e.target.value },
              })
            }
            className="h-9 text-sm font-mono"
            placeholder="notify-send 'Agent is working'"
          />
          <p className="text-xs text-muted-foreground">
            Runs when a session starts processing
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="hook-waiting" className="text-sm">
            On Waiting Input
          </Label>
          <Input
            id="hook-waiting"
            value={localConfig.statusHooks.onWaitingInput}
            onChange={(e) =>
              setLocalConfig({
                ...localConfig,
                statusHooks: { ...localConfig.statusHooks, onWaitingInput: e.target.value },
              })
            }
            className="h-9 text-sm font-mono"
            placeholder="osascript -e 'beep'"
          />
          <p className="text-xs text-muted-foreground">
            Runs when the agent is waiting for user input
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="hook-pending" className="text-sm">
            On Pending Auto Approval
          </Label>
          <Input
            id="hook-pending"
            value={localConfig.statusHooks.onPendingAutoApproval}
            onChange={(e) =>
              setLocalConfig({
                ...localConfig,
                statusHooks: { ...localConfig.statusHooks, onPendingAutoApproval: e.target.value },
              })
            }
            className="h-9 text-sm font-mono"
            placeholder="notify-send 'Awaiting approval'"
          />
          <p className="text-xs text-muted-foreground">
            Runs when auto-approval countdown starts
          </p>
        </div>
      </div>
    </div>
  )
}
