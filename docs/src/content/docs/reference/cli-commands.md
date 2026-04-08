---
title: CLI Commands
description: Command-line interface reference
---

## Main Command

```bash
argusdev
```

Launches ArgusDev. On first run, the setup wizard runs. After setup, the TUI (terminal interface) starts. If web interface is enabled, the API server runs in the background.

## Subcommands

### setup

```bash
argusdev setup [options]
```

Run the first-time setup wizard. Guides you through initial configuration.

**Options:**

| Flag | Description |
|------|-------------|
| `--no-web` | Disable the web interface |
| `--project <path>` | Add specified path as first project |
| `--skip-project` | Don't add any project during setup |
| `--force` | Overwrite existing config without asking |
| `--port <number>` | Set custom port for web interface |

### add

```bash
argusdev add [path]
```

Add a project to ArgusDev's tracking list.

- Without a path: adds the current directory
- With a path: adds the specified directory

The path must be a valid Git repository.

### remove

```bash
argusdev remove <path>
```

Remove a project from ArgusDev's list. This doesn't delete any files - it just stops tracking the project.

### list

```bash
argusdev list
```

Show all tracked projects with their paths.

### auth

```bash
argusdev auth <command>
```

Manage WebUI authentication.

**Subcommands:**

| Command | Description |
|---------|-------------|
| `show` | Display the WebUI access URL with token |
| `reset-passcode` | Change your passcode |
| `regenerate-token` | Generate a new access token (invalidates old URLs) |

## Global Options

| Flag | Description |
|------|-------------|
| `--help` | Show help text |
| `--version` | Show version number |
| `--port <number>` | Port for web interface (overrides config/env) |
| `--headless` | Run API server only, no TUI (useful for development) |
| `--devc-up-command` | Command to start devcontainer |
| `--devc-exec-command` | Command to execute in devcontainer |

## Examples

```bash
# Launch ArgusDev
argusdev

# Run first-time setup
argusdev setup

# Setup with custom port
argusdev setup --port 8080

# Add current directory as a project
argusdev add

# Add a specific project
argusdev add /path/to/my-project

# List all projects
argusdev list

# Show WebUI access URL
argusdev auth show

# Launch on a specific port
argusdev --port 8080

# Run headless (API server only)
argusdev --headless

# Run with devcontainer support
argusdev --devc-up-command "devcontainer up --workspace-folder ." \
     --devc-exec-command "devcontainer exec --workspace-folder ."
```

## Notes

- The `--devc-up-command` and `--devc-exec-command` flags must be used together
- Port can be set via flag, environment variable (`ARGUSDEV_PORT`), or config file (flag takes priority)
- Headless mode is mainly for development when you want just the API server
