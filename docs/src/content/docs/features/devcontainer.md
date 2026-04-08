---
title: Devcontainer Support
description: Run agents inside development containers
---

ArgusDev can run your AI agent sessions inside devcontainers. This is useful for sandboxing agent actions or working in projects that require a specific development environment.

## What This Does

When you provide devcontainer commands, ArgusDev will:

1. Start the devcontainer using your up command
2. Run the AI agent inside the container using your exec command
3. Stream the terminal output back to ArgusDev's interface

ArgusDev doesn't create or manage the devcontainer configuration - it just interfaces with existing setups.

## Requirements

- A project with a `.devcontainer/devcontainer.json` or similar setup
- The `devcontainer` CLI installed (or whatever tool manages your containers)
- Your container configured with the AI agents you want to use

## Usage

Start ArgusDev with the devcontainer flags:

```bash
argusdev --devc-up-command "devcontainer up --workspace-folder ." \
     --devc-exec-command "devcontainer exec --workspace-folder ."
```

Both flags are required - you can't use just one.

### Flags

- `--devc-up-command` - Command to start the devcontainer (runs before session creation)
- `--devc-exec-command` - Command prefix for running commands inside the container

## Example

Say you have a Node.js project with a devcontainer. You want Claude Code to run inside it:

```bash
cd /path/to/my-project
argusdev --devc-up-command "devcontainer up --workspace-folder ." \
     --devc-exec-command "devcontainer exec --workspace-folder ."
```

When you create a Claude session, ArgusDev will:
1. Run `devcontainer up --workspace-folder .` to ensure the container is running
2. Run `devcontainer exec --workspace-folder . -- claude` to start Claude inside the container

## Use Case: Sandboxed Execution

A common reason to use devcontainers is security. You can run Claude with `--dangerously-skip-permissions` inside a sandboxed container where it can't access your host filesystem or network:

```bash
argusdev --devc-up-command "devcontainer up --workspace-folder ." \
     --devc-exec-command "devcontainer exec --workspace-folder ."
```

Then configure your Claude agent profile to include the YOLO flag. The agent runs unrestricted, but only inside the container.

## Limitations

- You need to set up the devcontainer separately - ArgusDev doesn't create them
- The container needs the AI agents pre-installed or accessible
- Performance depends on your container setup
