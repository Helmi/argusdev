---
title: Session Data Copying
description: Preserve conversation context across worktrees
---

When you create a new worktree, ArgusDev can copy Claude Code's session data from an existing worktree. This lets you continue conversations and maintain context when branching off to work on something new.

## What Gets Copied

Claude Code stores its session data in a `.claude` directory. This includes:

- Conversation history
- Project context and memory
- Session state

When you copy session data, the new worktree gets a copy of this directory, so Claude "remembers" your previous conversations.

## When to Use It

**Copy session data when:**
- You're branching off a feature to explore a variation
- You want Claude to remember the context of what you've been working on
- You're creating a worktree for a closely related task

**Start fresh when:**
- You're starting something unrelated
- You want Claude to approach the new branch with no preconceptions
- The previous context might be confusing for the new task

## How to Enable

When creating a worktree through the WebUI, you'll see an option to copy session data. Check the box if you want to preserve context.

You can also set a default in settings:

1. Open **Settings**
2. Go to **Worktree** options
3. Toggle the default for **Copy Session Data**

## Notes

- Copying only works if the source worktree has a `.claude` directory
- If copying fails for any reason, the worktree is still created - you just start with a fresh session
- This feature is specific to Claude Code. Other agents manage their state differently.
