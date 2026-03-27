---
title: Environment Variables
description: Environment variable reference
---

ARGUSDEV uses these environment variables for configuration.

## Application Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ARGUSDEV_CONFIG_DIR` | Custom config directory path | `~/.config/argusdev` |
| `ARGUSDEV_PORT` | Port for the web interface | (from config) |
| `ARGUSDEV_DEV` | Enable dev mode (uses `.argusdev-dev/` in current dir) | unset |

### ARGUSDEV_CONFIG_DIR

Override the default config directory. Useful if you want to keep ARGUSDEV config in a different location.

```bash
export ARGUSDEV_CONFIG_DIR=/path/to/custom/config
argusdev
```

### ARGUSDEV_PORT

Set the web interface port without using the `--port` flag.

```bash
export ARGUSDEV_PORT=8080
argusdev
```

Note: The `--port` flag takes priority over this variable.

### ARGUSDEV_DEV

When set to `1`, ARGUSDEV uses `.argusdev-dev/` in the current directory instead of the global config. Useful for development.

```bash
export ARGUSDEV_DEV=1
argusdev
```

## Hook Environment Variables

These variables are available to hooks (status hooks, worktree hooks, project scripts).

### Status Hooks

| Variable | Description |
|----------|-------------|
| `ARGUSDEV_WORKTREE_PATH` | Path to the session's worktree |
| `ARGUSDEV_WORKTREE_BRANCH` | Branch name |
| `ARGUSDEV_GIT_ROOT` | Git repository root |
| `ARGUSDEV_SESSION_ID` | Session identifier |
| `ARGUSDEV_OLD_STATE` | Previous state (idle, busy, waiting_input) |
| `ARGUSDEV_NEW_STATE` | New state |

### Worktree Hooks

| Variable | Description |
|----------|-------------|
| `ARGUSDEV_WORKTREE_PATH` | Path to the new worktree |
| `ARGUSDEV_WORKTREE_BRANCH` | Branch name |
| `ARGUSDEV_GIT_ROOT` | Git repository root |
| `ARGUSDEV_BASE_BRANCH` | Branch the worktree was created from |

### Project Scripts (.argusdev.json)

| Variable | Description |
|----------|-------------|
| `ARGUSDEV_ROOT_PATH` | Git repository root |
| `ARGUSDEV_WORKTREE_PATH` | Path to the worktree |
| `ARGUSDEV_WORKTREE_NAME` | Worktree name |
| `ARGUSDEV_BRANCH` | Branch name |

## Priority Order

For port configuration:

1. `--port` flag (highest priority)
2. `ARGUSDEV_PORT` environment variable
3. Config file setting
4. Default: `3000`

For config directory:

1. `ARGUSDEV_CONFIG_DIR` (highest priority)
2. `ARGUSDEV_DEV=1` (uses `.argusdev-dev/`)
3. Default: `~/.config/argusdev`
