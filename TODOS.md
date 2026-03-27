# TODOS

## Launch Prep

### Add E2E onboarding test

**What:** Automate the fresh install → setup wizard → browser opens → passcode → working dashboard flow.

**Why:** This is the most critical user path for public launch. Manual testing catches issues once; automated testing catches regressions forever.

**Context:** Setup wizard exists in `setupService.ts`. Could use Playwright or the `/qa` skill. Test should: simulate clean config dir, run setup, verify config creation + token generation + URL display, then hit the WebUI endpoint and verify passcode flow works.

**Effort:** M
**Priority:** P2

## Completed

### Rename `ensureDaemonForTui` → `ensureDaemon` (done)
### Drop TUI: remove Ink-based TUI, dependencies, and `tui` command (done)
### Audit root package.json dependencies post-TUI removal (done)
