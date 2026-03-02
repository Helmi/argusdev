#!/usr/bin/env bash
SCRIPT_PATH="$0"
cleanup() { rm -f "$SCRIPT_PATH"; }
trap cleanup EXIT
CACD_PROMPT=$(cat <<'CACD_PROMPT_1772441313466AM2FM7F_EOF'
Use td workflow reminders: run td usage --new-session for new conversations, and td usage -q in this conversation.

This session is linked to td task td-ced044.

You are reviewing td-ced044 — Epic detail: show child task statuses with Fix action on rejected tasks.

**Priority:** P1

## Description
The task detail modal for epics currently shows child tasks as a flat list without meaningful status context. When working on an epic where some subtasks were rejected, the user has no UI path to find and fix them.

Changes needed in TaskDetailModal.tsx (epic view):
- Show each child task with its current status indicator (same icons/colors as board)
- Group children by status: needs-fix (in_progress after rejection) first, then in_review, open, closed
- 'Needs fix' children (in_progress tasks that have a rejection in their log): show a highlighted 'Fix' button
- 'Fix' button starts a session linked to THAT SUBTASK (not the epic), using the Fix Rejected Work prompt
- 'Start' button for open subtasks not yet started

The board already has 'Start Working' logic — reuse it scoped to the child task ID.

The key insight: when working on an epic, the user should always be starting sessions for SUBTASKS, not the epic itself. The UI needs to make this obvious and easy.

## Acceptance Criteria
- Epic detail modal shows all child tasks with status indicators
- Children grouped: needs-fix first, then in_review, then open, then closed
- 'Fix' button on rejected subtasks starts a session for that subtask with rejection context
- 'Start' button on open subtasks starts a normal work session
- No change needed to close/in_review children (read-only)

## What to Check
- Acceptance criteria are fully met — verify each one explicitly
- No regressions or obvious bugs introduced
- Error handling is adequate for failure cases
- Tests cover the changes and pass
- Code is readable and consistent with the surrounding codebase

## Get Full Context First
Run this before reviewing:
```
td context td-ced044
```
This shows what the implementer did, what decisions were made, and what they flagged as uncertain.

## After Your Review

**If the work is good:**
```
td approve td-ced044
```

**If changes are needed — be specific:**
```
td reject td-ced044 --reason "describe exactly what needs fixing"
```

The rejection reason is injected into the next implementation session. Vague reasons cause bad fixes. Be precise: what is wrong, where, and what the correct behavior should be.

Do not end this session without running either `td approve` or `td reject`. The task will stay stuck in review otherwise.
CACD_PROMPT_1772441313466AM2FM7F_EOF
)
codex --yolo "$CACD_PROMPT"
