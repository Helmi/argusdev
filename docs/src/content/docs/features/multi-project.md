---
title: Multi-Project Support
description: Manage multiple repositories from one interface
---

ArgusDev can manage multiple Git repositories from a single interface. This is handy if you work across several projects and want to keep your AI sessions organized.

## Adding a Project

### From the WebUI

1. Click the project selector in the sidebar
2. Click **Add Project**
3. Enter the path to a Git repository
4. The project appears in your list

### From the CLI

```bash
# Add the current directory
argusdev add

# Add a specific path
argusdev add /path/to/project
```

## Listing Projects

```bash
argusdev list
```

Shows all tracked projects with their paths.

## Removing a Project

```bash
argusdev remove /path/to/project
```

This only removes the project from ArgusDev's list - it doesn't delete any files.

## Switching Projects

Click on a project in the sidebar to switch to it. The worktree list and sessions update to show that project's context.

Sessions from other projects keep running in the background. You can switch back anytime.

## Project Indicators

The project list shows session counts for each project:

- How many sessions are active
- How many are busy
- How many are waiting for input

This helps you spot which projects need attention without switching to them.

## Recent Projects

Projects you've used recently appear at the top of the list for quick access. ArgusDev tracks when you last accessed each project.

## How It Works

ArgusDev stores your project list in `~/.config/argusdev/projects.json`. Each project entry includes:

- Path to the repository
- Display name
- Last accessed timestamp
- Any project-specific metadata (like Claude task list names)
