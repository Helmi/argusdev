---
title: Git Worktrees
description: Manage multiple branches simultaneously
---

Git worktrees let you have multiple branches checked out at the same time, each in its own directory. ArgusDev is built around this concept - each AI agent session runs on its own worktree, so agents can work on different branches without conflicts.

## What Are Worktrees?

Normally, a Git repository has one working directory. If you want to work on a different branch, you have to stash or commit your changes and switch branches.

With worktrees, you can have `feature-a` checked out in one folder and `feature-b` in another, simultaneously. Both share the same Git history but have independent working directories.

## Why Use Worktrees with AI Agents?

- **Parallel work** - Run Claude on `feature-login` while Gemini works on `feature-dashboard`
- **No conflicts** - Each agent has its own sandbox
- **Easy comparison** - Switch between branches without losing context
- **Clean isolation** - Agent changes don't affect your main working directory

## Creating a Worktree

From the WebUI:

1. Click **New Worktree** or create one while starting a new session
2. Enter a branch name (new or existing)
3. Optionally specify a directory path (or let ArgusDev auto-generate it)
4. Click **Create**

ArgusDev creates the worktree and you can immediately start a session on it.

## Auto-Directory

By default, ArgusDev can auto-generate worktree paths based on branch names. Enable this in settings to skip manually entering paths every time.

The pattern uses `{branch}` as a placeholder. For example, with pattern `../worktrees/{branch}`:
- Branch `feature/login` becomes `../worktrees/feature-login`
- Branch names are sanitized to be filesystem-safe

## Merging a Worktree

When you're done with a feature:

1. Select the worktree
2. Click **Merge**
3. Choose whether to use rebase
4. Confirm

ArgusDev merges the worktree's branch into your target branch (typically `main`).

## Deleting a Worktree

1. Select the worktree
2. Click **Delete**
3. Optionally delete the branch as well
4. Confirm

The worktree directory is removed. If you had sessions running on it, they'll be terminated.

## Tips

- Keep worktrees in a sibling directory (like `../worktrees/`) to keep things organized
- Use descriptive branch names - they'll become your worktree identifiers
- Don't forget to merge or clean up worktrees when you're done with a feature
