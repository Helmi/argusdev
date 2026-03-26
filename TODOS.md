# TODOS

## Launch Prep

### Rename `ensureDaemonForTui` after TUI removal

**What:** Rename `ensureDaemonForTui()` in `daemonControl.ts` to `ensureDaemon()` or `ensureDaemonRunning()`.

**Why:** After TUI removal, this function name is misleading — it manages general daemon lifecycle, not TUI-specific behavior. Contributors will be confused by the name.

**Context:** The function checks if a daemon is running, starts one if needed, and returns the web config. 5 callers across cli.tsx and daemonControl.test.ts. Straightforward rename + test update.

**Effort:** S
**Priority:** P2
**Depends on:** TUI removal (Phase 1a)

### Audit root package.json dependencies post-TUI removal

**What:** After removing TUI code, audit remaining root `package.json` dependencies. Check if `@types/react-syntax-highlighter` and other packages belong in root or should move to `client/package.json`.

**Why:** Root deps increase `npm install` size for CLI-only users. After TUI removal, many React-related types may be orphaned in root.

**Context:** The WebUI has its own `client/package.json`. Types and deps only used by the WebUI should live there. Also remove `ink`, `ink-select-input`, `ink-text-input`, `ink-testing-library`, `react` (from root only).

**Effort:** S
**Priority:** P1
**Depends on:** TUI removal (Phase 1a)

### Add E2E onboarding test

**What:** Automate the fresh install → setup wizard → browser opens → passcode → working dashboard flow.

**Why:** This is the most critical user path for public launch. Manual testing catches issues once; automated testing catches regressions forever.

**Context:** Setup wizard exists in `setupService.ts`. Could use Playwright or the `/qa` skill. Test should: simulate clean config dir, run setup, verify config creation + token generation + URL display, then hit the WebUI endpoint and verify passcode flow works.

**Effort:** M
**Priority:** P2
**Depends on:** Rename completion (Phase 2)

## Completed
