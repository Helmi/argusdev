---
title: Status Hooks
description: Trigger actions when session states change
---

Status hooks let you run custom commands when a session's state changes. This is useful for notifications, logging, or triggering automations.

## Hook Types

You can configure hooks for each state transition:

| Hook | Triggers When |
|------|---------------|
| **On Idle** | Session finishes working and is ready for input |
| **On Busy** | Session starts processing a request |
| **On Waiting Input** | Session needs your confirmation or input |
| **On Pending Auto-Approval** | Session is being evaluated for auto-approval |

## Configuring Hooks in the WebUI

The WebUI makes it easy to set up status hooks:

1. Click the **gear icon** in the header to open Settings
2. Select **Status Hooks** from the sidebar
3. Enter a shell command for each state you want to hook
4. Toggle the hook on with the checkbox
5. Click **Save Changes**

<div class="screenshot-placeholder">
Screenshot: Settings → Status Hooks panel with notification commands configured
</div>

## Environment Variables

Your hook commands have access to these variables:

| Variable | Description |
|----------|-------------|
| `ARGUSDEV_WORKTREE_PATH` | Path to the session's worktree |
| `ARGUSDEV_WORKTREE_BRANCH` | Branch name of the worktree |
| `ARGUSDEV_GIT_ROOT` | Root of the Git repository |
| `ARGUSDEV_SESSION_ID` | Unique ID of the session |
| `ARGUSDEV_OLD_STATE` | Previous state (idle, busy, waiting_input) |
| `ARGUSDEV_NEW_STATE` | New state |

## Examples

### Desktop Notification (macOS)

Get notified when a session needs attention:

```bash
osascript -e 'display notification "Session needs input" with title "ArgusDev"'
```

### Desktop Notification (Linux)

```bash
notify-send "ArgusDev" "Session needs input"
```

### Logging

Log state changes to a file:

```bash
echo "$(date): $ARGUSDEV_SESSION_ID changed from $ARGUSDEV_OLD_STATE to $ARGUSDEV_NEW_STATE" >> ~/.argusdev-log.txt
```

### Play a Sound

```bash
afplay /System/Library/Sounds/Ping.aiff
```

### Slack/Discord Webhook

```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"ArgusDev session waiting for input"}' \
  YOUR_WEBHOOK_URL
```

## Tips

- Keep hooks fast - slow commands will delay state updates
- Hook failures don't break ArgusDev, but check your commands work standalone first
- Use `On Waiting Input` for notifications - that's when you need to act
- Combine with terminal multiplexers or window managers to auto-focus ArgusDev when needed
