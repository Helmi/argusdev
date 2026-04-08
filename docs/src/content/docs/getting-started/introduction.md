---
title: Introduction
description: What is ArgusDev and why use it?
---

**ArgusDev** is a control plane for managing multiple AI coding assistant sessions across projects and Git worktrees.

## The Problem

When working with AI coding assistants like Claude Code, Gemini CLI, or Codex, you often need to:

- Run multiple sessions in parallel on different tasks
- Keep agents isolated on separate branches to avoid conflicts
- Monitor which agent is busy, idle, or waiting for input
- Switch between projects without losing context

Managing this manually across terminals gets messy fast.

## The Solution

ArgusDev provides a unified interface - both WebUI and TUI - to:

- **Launch and manage** multiple AI agent sessions
- **Organize work** using Git worktrees (one branch per agent)
- **Monitor status** with visual indicators (idle, busy, waiting)
- **Switch contexts** between projects seamlessly
- **Automate workflows** with hooks and status triggers

## Supported Agents

ArgusDev auto-detects and works with:

- **Claude Code** - Anthropic's CLI coding assistant
- **Gemini CLI** - Google's CLI assistant
- **Codex CLI** - OpenAI's coding assistant
- **Cursor Agent** - Cursor's CLI interface
- **Droid**, **Kilocode**, **Opencode** - Other CLI assistants

Plus built-in state detection for GitHub Copilot CLI and Cline.

## Next Steps

- [Installation](/argusdev/getting-started/installation/) - Get ArgusDev installed
- [Quick Start](/argusdev/getting-started/quick-start/) - Launch your first session
