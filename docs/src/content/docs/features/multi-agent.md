---
title: Multi-Agent Support
description: Work with different AI coding assistants
---

ArgusDev supports multiple AI coding assistants. You can run different agents side-by-side, each on its own worktree.

## Auto-Detected Agents

During setup, ArgusDev checks for these agents and adds any it finds:

### Claude Code

Anthropic's CLI coding assistant.

**Command:** `claude`

**Options:**
- **YOLO Mode** - Skip permission prompts (`--dangerously-skip-permissions`)
- **Continue** - Continue the last conversation (`--continue`)
- **Resume** - Resume a specific conversation (`--resume`)
- **Model** - Choose between Sonnet, Opus, or Haiku

### Gemini CLI

Google's AI assistant for the command line.

**Command:** `gemini`

**Options:**
- **Model** - Select the Gemini model to use

### Codex CLI

OpenAI's coding assistant.

**Command:** `codex`

**Options:**
- **Model** - Select the model to use

### Cursor Agent

The CLI interface for Cursor's AI capabilities.

**Command:** `cursor agent`

### Droid

**Command:** `droid`

### Kilocode

**Command:** `kilocode`

### Opencode

**Command:** `opencode`

### Terminal

A plain shell session without any AI. Always available regardless of detection.

**Command:** `$SHELL` (your default shell)

## Agents with State Detection

These agents have built-in state detection patterns but aren't auto-detected. You can add them as custom agent profiles:

- **GitHub Copilot CLI** (`gh copilot`)
- **Cline**

## State Detection

ArgusDev monitors each agent's terminal output to detect its state (idle, busy, waiting). Each agent has its own detection patterns since they display prompts and status differently.

This means ArgusDev can tell you when an agent needs your attention, even if you're looking at a different session.

## Custom Agents

You can create custom agent profiles for any CLI tool. See [Agent Profiles](/argusdev/configuration/agent-profiles/) for details on setting up your own configurations.

## Switching Agents

Each session is tied to one agent, but you can:

- Run multiple sessions with different agents simultaneously
- Create a new session with a different agent on the same or different worktree
- Configure which agent is your default for new sessions
