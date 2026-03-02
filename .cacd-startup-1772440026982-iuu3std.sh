#!/usr/bin/env bash
SCRIPT_PATH="$0"
cleanup() { rm -f "$SCRIPT_PATH"; }
trap cleanup EXIT
CACD_PROMPT=$(cat <<'CACD_PROMPT_1772440026982IUU3STD_EOF'
Use td workflow reminders: run td usage --new-session for new conversations, and td usage -q in this conversation.

This session is linked to td task td-bf5403.

You are starting work on td-bf5403 — Auto-refresh worktrees and projects on filesystem changes.

**Priority:** P1 | **Status:** open

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

## Your Workflow
1. Run `td usage -q` to check current state and any previous handoff context
2. Run `td start td-bf5403` if not already started (may have been auto-started)
3. As you work:
   - `td log "what you did"` for progress
   - `td log --decision "why you chose X"` for decisions
   - `td log --blocker "what's blocking you"` if stuck
4. Before this session ends — always, even if incomplete:
   ```
   td handoff td-bf5403 \
     --done "what is actually complete" \
     --remaining "what is left" \
     --decision "key choices made" \
     --uncertain "open questions"
   ```
5. When implementation is complete and tests pass: `td review td-bf5403`

Check `td context td-bf5403` to see any previous handoff from an earlier session.
CACD_PROMPT_1772440026982IUU3STD_EOF
)
pi --tools read,bash,edit,write,grep,find,ls --thinking high "$CACD_PROMPT"
