---
title: Auto-Approval
description: Automatically approve safe agent actions
sidebar:
  badge:
    text: Experimental
    variant: caution
---

Auto-approval lets ArgusDev automatically respond to agent permission prompts when the requested action appears safe. Instead of you clicking "approve" for every read-only operation, ArgusDev can handle the obvious ones.

:::caution
This feature is experimental. It uses AI to judge safety, which isn't foolproof. Use it in low-risk environments and keep an eye on what's being approved.
:::

## How It Works

When an agent enters a "waiting for input" state, ArgusDev can analyze the terminal output and decide:

1. **Needs permission** - Something risky is happening. Wait for you.
2. **Safe to approve** - It's a read-only or low-risk operation. Approve automatically.

The analysis uses Claude Haiku to quickly evaluate the situation.

## What Gets Blocked (Requires Your Approval)

- **File modifications** - Writing, deleting, moving files
- **Package managers** - npm install, pip install, apt install, etc.
- **Git changes** - Commits, pushes, history rewrites
- **System operations** - sudo, service restarts, permission changes
- **Network operations** - curl/wget to unknown hosts, ssh connections
- **Sensitive areas** - SSH keys, credentials, dotfiles, /etc configs

## What Gets Approved Automatically

- **Read-only operations** - Viewing files, listing directories
- **Tests and linting** - Running test suites, lint checks
- **Help and info** - Showing help text, version info
- **Dry runs** - Formatting checks, build previews

## Enabling Auto-Approval

1. Open **Settings** in the WebUI
2. Go to the **General** section
3. Toggle **Auto-Approval** on
4. Optionally adjust the timeout (default: 30 seconds)

## Timeout

If the safety check takes too long, auto-approval falls back to waiting for your input. The default timeout is 30 seconds, but you can adjust this in settings.

## Custom Verification Command

You can replace the built-in Claude Haiku check with your own script. Your command receives the terminal output and should return JSON indicating whether permission is needed:

```json
{"needsPermission": true, "reason": "Attempting to delete files"}
```

or

```json
{"needsPermission": false}
```

Configure this in settings under **Auto-Approval Command**.

## Tips

- Start with auto-approval disabled until you're comfortable with how your agents behave
- Use it on isolated worktrees where mistakes are easy to undo
- The Haiku model is fast but not perfect - review your session history occasionally
