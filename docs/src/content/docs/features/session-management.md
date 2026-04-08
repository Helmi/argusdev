---
title: Session Management
description: Creating, monitoring, and managing AI agent sessions
---

Sessions are the core of ArgusDev. Each session represents a running AI coding assistant (like Claude Code or Gemini CLI) attached to a specific Git worktree.

## Creating a Session

From the WebUI:

1. Click **New Session** in the sidebar
2. Select an agent (Claude Code, Gemini, etc.)
3. Configure any agent-specific options
4. Pick an existing worktree or create a new one
5. Click **Create**

The session starts immediately and you'll see the terminal output in the main area.

## Session States

Each session has one of four states:

| State | Indicator | Meaning |
|-------|-----------|---------|
| **Idle** | Green | Agent is ready and waiting for your input |
| **Busy** | Yellow | Agent is processing a request |
| **Waiting** | Red | Agent needs your confirmation (e.g., to run a command) |
| **Pending Auto-Approval** | - | Being evaluated for automatic approval (if enabled) |

ArgusDev detects these states by analyzing the terminal output. Different agents have different detection patterns - Claude Code, Gemini, and others each have their own way of signaling state.

## Monitoring Sessions

The sidebar shows all active sessions with their current state. You can:

- Click a session to view its terminal
- See at a glance which sessions need attention (red = waiting)
- Monitor multiple sessions across different worktrees

## Session Names

Sessions are automatically named based on the worktree and agent. For Claude Code sessions, ArgusDev also tracks the task list name if you're using Claude's task list feature.

## Destroying Sessions

To end a session:

1. Select the session in the sidebar
2. Click the destroy/close button
3. Confirm if prompted

The worktree remains intact - only the agent session is terminated. You can start a new session on the same worktree anytime.

## Tips

- Run multiple sessions in parallel on different worktrees to work on several features at once
- Keep an eye on the state indicators - a "waiting" session might be blocked until you respond
- Sessions persist across page refreshes but not across ArgusDev restarts
