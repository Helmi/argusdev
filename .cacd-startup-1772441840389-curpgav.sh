#!/usr/bin/env bash
SCRIPT_PATH="$0"
cleanup() { rm -f "$SCRIPT_PATH"; }
trap cleanup EXIT
CACD_PROMPT=$(cat <<'CACD_PROMPT_1772441840389CURPGAV_EOF'
Use td workflow reminders: run td usage --new-session for new conversations, and td usage -q in this conversation.

This session is linked to td task td-bf5403.

You are reviewing td-bf5403 — Auto-refresh worktrees and projects on filesystem changes.

**Priority:** P1

## Description
Worktrees and project lists only refresh when CACD itself performs an operation (add/create/merge via UI). External changes — agents creating worktrees via git, CLI git operations — are invisible until the user manually triggers a refresh or reloads.

Fix: watch the git worktree directory (.git/worktrees/) for changes. On change (debounced), emit a worktrees_changed socket event. Frontend triggers fetchData() for worktrees.

Also consider: watch projects.json for changes (project list added/removed outside UI).

Backend: add file watcher alongside the td watcher (same pattern as td-0df4b3).
Frontend: socket.on('worktrees_changed', ...) → fetchData()

## Acceptance Criteria
- Worktree list updates when git worktree is created/deleted externally
- Project list updates when projects.json changes externally
- Watchers are scoped per-project and clean up on project switch/daemon shutdown
- Debounced to prevent rapid re-fetches on git operations

## What to Check
- Acceptance criteria are fully met — verify each one explicitly
- No regressions or obvious bugs introduced
- Error handling is adequate for failure cases
- Tests cover the changes and pass
- Code is readable and consistent with the surrounding codebase

## Get Full Context First
Run this before reviewing:
```
td context td-bf5403
```
This shows what the implementer did, what decisions were made, and what they flagged as uncertain.

## After Your Review

**If the work is good:**
```
td approve td-bf5403
```

**If changes are needed — be specific:**
```
td reject td-bf5403 --reason "describe exactly what needs fixing"
```

The rejection reason is injected into the next implementation session. Vague reasons cause bad fixes. Be precise: what is wrong, where, and what the correct behavior should be.

Do not end this session without running either `td approve` or `td reject`. The task will stay stuck in review otherwise.
CACD_PROMPT_1772441840389CURPGAV_EOF
)
codex --yolo "$CACD_PROMPT"
