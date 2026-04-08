---
title: Status Detection
description: How ArgusDev knows what your agents are doing
---

ArgusDev monitors your AI agent sessions and detects their current state. This lets you see at a glance which sessions need attention and which are still working.

## Session States

### Idle (Green)

The agent is ready and waiting for your input. It's finished processing and is sitting at its prompt.

### Busy (Yellow)

The agent is actively working - generating code, thinking, or executing commands. Give it time to finish.

### Waiting for Input (Red)

The agent is asking you a question or needs confirmation before proceeding. This usually means it wants to run a command or make a change and is waiting for your approval.

### Pending Auto-Approval

If auto-approval is enabled, ArgusDev evaluates whether the pending action is safe to approve automatically. This state is temporary while the check runs.

## How Detection Works

ArgusDev analyzes the terminal output from each session to determine its state. Different agents display their prompts and status in different ways, so ArgusDev has detection patterns for each supported agent:

- **Claude Code** - Detects Claude's prompts and permission requests
- **Gemini CLI** - Matches Gemini's specific output patterns
- **Codex CLI** - Recognizes Codex's prompt style
- **Cursor** - Identifies Cursor Agent markers
- **GitHub Copilot** - Matches Copilot CLI patterns
- **Cline** - Detects Cline's tool approval prompts

## Visual Indicators

The sidebar shows colored dots next to each session:

- 🟢 Green = Idle
- 🟡 Yellow = Busy
- 🔴 Red = Waiting

Project entries also show aggregate counts like `[3/1/0]` meaning 3 idle, 1 busy, 0 waiting.

## Status Hooks

You can trigger scripts when session states change. For example, get a desktop notification when an agent finishes working or needs your input. See [Status Hooks](/argusdev/configuration/status-hooks/) for setup instructions.

## Limitations

State detection is based on pattern matching, so it's not perfect. If an agent displays unexpected output or your terminal has unusual formatting, detection might be delayed or incorrect.

If you notice detection issues with a specific agent, the patterns may need adjustment for your setup.
