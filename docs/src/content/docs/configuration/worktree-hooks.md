---
title: Worktree Hooks
description: Automate setup when creating worktrees
---

Worktree hooks run automatically after you create a new worktree. Use them to set up the development environment without manual steps.

## Post-Creation Hook

The post-creation hook runs after a worktree is successfully created. Common uses:

- Install dependencies (`npm install`, `bundle install`, etc.)
- Set up environment files
- Initialize development tools
- Run setup scripts

## Configuring Hooks in the WebUI

The WebUI makes it easy to set up worktree hooks:

1. Click the **gear icon** in the header to open Settings
2. Select **Worktree Hooks** from the sidebar
3. Enter your shell command in the **Post-Creation Hook** field
4. Click **Save Changes**

<div class="screenshot-placeholder">
Screenshot: Settings → Worktree Hooks panel with npm install command configured
</div>

## Environment Variables

Your hook has access to:

| Variable | Description |
|----------|-------------|
| `ARGUSDEV_WORKTREE_PATH` | Path to the new worktree |
| `ARGUSDEV_WORKTREE_BRANCH` | Branch name |
| `ARGUSDEV_GIT_ROOT` | Root of the Git repository |
| `ARGUSDEV_BASE_BRANCH` | Branch the worktree was created from (if applicable) |

## Examples

### Install Node Dependencies

```bash
cd "$ARGUSDEV_WORKTREE_PATH" && npm install
```

### Install Multiple Dependency Types

```bash
cd "$ARGUSDEV_WORKTREE_PATH" && npm install && pip install -r requirements.txt
```

### Copy Environment File

```bash
cp "$ARGUSDEV_GIT_ROOT/.env.example" "$ARGUSDEV_WORKTREE_PATH/.env"
```

### Run Project Setup Script

```bash
cd "$ARGUSDEV_WORKTREE_PATH" && ./scripts/setup.sh
```

### Notify When Done

```bash
cd "$ARGUSDEV_WORKTREE_PATH" && npm install && notify-send "Worktree ready" "$ARGUSDEV_WORKTREE_BRANCH"
```

## How It Works

- Hooks run asynchronously - worktree creation doesn't wait for them to finish
- Hook failures are logged but don't prevent worktree creation
- The hook runs in a shell, so you can chain commands with `&&`

## Tips

- Test your commands manually first
- Keep hooks reasonably fast - long installs are fine, but don't block on interactive prompts
- Use `cd "$ARGUSDEV_WORKTREE_PATH"` at the start to ensure you're in the right directory
- Chain commands with `&&` so later steps only run if earlier ones succeed
