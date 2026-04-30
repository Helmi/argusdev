# Research: Hook Availability for GitHub Copilot CLI and Kilocode

**Task:** td-ef593d  
**Date:** 2026-04-29  
**Researcher:** res-593d (agent session)

---

## 1. Methodology

Investigation steps taken, in order:

1. Read existing ArgusDev adapter and hook infrastructure:
   - `src/adapters/githubCopilot.ts` — current adapter (PTY regex only, `detectionStrategy: 'github-copilot'`)
   - `src/adapters/kilocode.ts` — current adapter (no `detectionStrategy`, no `generateHookConfig`)
   - `src/adapters/stateDetection.ts` — confirmed `detectGitHubCopilotState()` exists; no `detectKilocodeState()`
   - `src/utils/hookSettings.ts` — full hook infrastructure for Claude, Codex, OpenCode, Gemini, Pi

2. Read td-3baf11 (Cursor BLOCKED case) for reference on what "incomplete implementation" looks like.

3. Checked CLI availability locally:
   - `gh copilot --help` — Copilot CLI not installed on this machine (output: "Copilot CLI not installed")
   - `kilocode` — not in PATH

4. Fetched official GitHub Docs pages (all VERIFIED sources):
   - `https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks` — 8-event authoritative list
   - `https://docs.github.com/en/copilot/reference/hooks-configuration` — config format + I/O schema
   - `https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks` — CLI-specific how-to
   - `https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks` — CLI tutorial with config file path
   - `https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-hooks` — cloud agent page

5. Fetched third-party CLI-specific write-up for cross-check:
   - `https://bartwullems.blogspot.com/2026/03/github-copilot-cli-tips-tricks-part-4.html`
   - `https://smartscope.blog/en/generative-ai/github-copilot/github-copilot-hooks-guide/`

6. Checked `github/copilot-cli` issue tracker:
   - Issue #1157 — feature request for `UserPromptSubmit`/`Stop`/`Notification` hooks (closed; no maintainer response; user notes `userPromptSubmitted` may not be reliable in practice)

7. For Kilocode: searched GitHub (`Kilo-Org/kilocode`), fetched:
   - `https://github.com/Kilo-Org/kilocode` — architecture overview
   - `https://kilo.ai/docs/code-with-ai/platforms/cli` — official CLI docs
   - `https://github.com/Kilo-Org/kilocode/blob/main/AGENTS.md` — dev guidelines
   - `https://github.com/Kilo-Org/kilocode/issues/5827` — feature request for session lifecycle hooks
   - `https://deepwiki.com/Kilo-Org/kilocode/3-core-features` — architectural deep dive
   - `https://www.npmjs.com/package/@kilocode/cli` — returned 403

**What was NOT tested:** Actual hook execution in a live terminal session (CLI not installed locally). `agentStop` CLI behavior at runtime is documented but not smoke-tested in a real PTY.

---

## 2. GitHub Copilot CLI

### What the CLI is

`gh copilot` is a terminal-based AI coding agent. As of February 2026 it reached GA. It runs in a PTY session and accepts prompts interactively or via `-p` flag. The `gh copilot` command downloads and runs a separate `copilot` binary.

### Hook surface

**8 events are documented** in the official "About hooks" page. All 8 are described as available for both cloud agent and CLI:

| Event | JSON key | ArgusDev trigger condition | ArgusDev state |
|---|---|---|---|
| Session start | `sessionStart` | new or resumed session | `idle` |
| User prompt submitted | `userPromptSubmitted` | user sends a message | `busy` |
| Pre-tool use | `preToolUse` | before any tool runs | `busy` |
| Post-tool use | `postToolUse` | after tool completes | (informational) |
| Agent stop | `agentStop` | "main agent has finished responding to your prompt" | `idle` |
| Subagent stop | `subagentStop` | subagent completes before returning to parent | (informational) |
| Session end | `sessionEnd` | session completes or is terminated | `idle` |
| Error occurred | `errorOccurred` | error during execution | (informational) |

**Critical for ArgusDev:** `agentStop` fires per-response (not per session exit). This is the idle signal. `userPromptSubmitted` + `preToolUse` → busy. There is **no dedicated `waiting_input` event** — no permission prompt hook exists.

### Config format

Source: `https://docs.github.com/en/copilot/reference/hooks-configuration`

```json
{
  "version": 1,
  "hooks": {
    "agentStop": [
      {
        "type": "command",
        "bash": "curl -s -X POST http://127.0.0.1:<port>/api/internal/sessions/<id>/hook-state/idle > /dev/null 2>&1 || true",
        "timeoutSec": 5
      }
    ]
  }
}
```

Hook type is **`command` only** — no `http` type, no plugin type. Hooks receive JSON via stdin; output is ignored for all events except `preToolUse` (which can return `{"permissionDecision": "deny"}`).

Input schema per event (source: hooks-configuration reference page):
- `sessionStart`: `{timestamp, cwd, source, initialPrompt}`
- `sessionEnd`: `{timestamp, cwd, reason}`
- `userPromptSubmitted`: `{timestamp, cwd, prompt}`
- `preToolUse`: `{timestamp, cwd, toolName, toolArgs}`
- `postToolUse`: `{timestamp, cwd, toolName, toolArgs, toolResult}`
- `errorOccurred`: `{timestamp, cwd, error: {message, name, stack}}`
- `agentStop`, `subagentStop`: not detailed in fetched content (likely `{timestamp, cwd}`)

### Config file location (CLI)

Source: `https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks`

> "For GitHub Copilot CLI, hooks are loaded from your current working directory."

Exact path: `.github/hooks/<anyname>.json` — the filename is arbitrary; all `.json` files in `.github/hooks/` are loaded. Example used in tutorial: `.github/hooks/copilot-cli-policy.json`.

This aligns with ArgusDev's pattern of writing per-session hook configs to the worktree.

### Known gaps and risks

1. **No `waiting_input` event.** There is no permission-prompt hook. The PTY regex fallback (`detectGitHubCopilotState()`) must stay for `waiting_input`. This is analogous to Gemini's `waiting_input` gap (see `buildGeminiHookConfig` comment in `hookSettings.ts`).

2. **`agentStop` CLI confirmation confidence.** The official "About hooks" page lists it as CLI-available, and a March 2026 CLI blog post confirms it in the 8-event list. However, issue #1157 (user filed for a "Stop" event, suggesting it didn't exist or work at that time; issue is closed with no maintainer comment) is a mild signal that this area has had turbulence. The blog post post-dates the issue and is the more current source. **Confidence: DOCUMENTED** for CLI applicability of `agentStop` — it's in official docs but not smoke-tested.

3. **Cursor parallel.** Unlike Cursor (td-3baf11), where source code confirmed `stop` and `beforeSubmitPrompt` were discarded in CLI, there is no source-level evidence of similar gaps in Copilot CLI. The feature request pattern is different: Cursor shipped hooks half-finished; Copilot CLI launched with a complete 8-event system per the GA release notes.

4. **`curl` dependency.** Hook type is `command` (curl), not native `http`. This matches the Codex and Gemini approach in ArgusDev — no new constraint.

### Confidence levels

| Claim | Confidence |
|---|---|
| 8 events exist for CLI | DOCUMENTED (official GitHub docs, March 2026 blog) |
| Config path is `.github/hooks/*.json` in cwd | DOCUMENTED (official tutorial) |
| Hook type is `command` only | DOCUMENTED |
| `agentStop` fires per-response (not per session exit) | DOCUMENTED ("finished responding to your prompt") |
| `agentStop` works in CLI mode specifically | DOCUMENTED (listed as CLI-available in About hooks page) |
| No `waiting_input` / permission-prompt hook | DOCUMENTED (no such event in any source) |
| Hooks GA for CLI as of Feb 2026 | DOCUMENTED (GitHub changelog) |

### Recommendation

**PROCEED** with hook-based implementation, with PTY fallback retained for `waiting_input`.

State mapping:
- `userPromptSubmitted` → `busy`
- `preToolUse` → `busy`
- `agentStop` → `idle`
- `sessionStart` → `idle`
- `waiting_input` → PTY regex only (existing `detectGitHubCopilotState()` kept active; `partialHook: true`)

Implementation approach follows Gemini's `writeGeminiHookFiles` pattern: write `.github/hooks/<sessionId>.json` in the worktree, clean up on session end. No global config to patch.

---

## 3. Kilocode

### What Kilocode is

Kilocode is an open-source AI coding agent available as a VS Code extension, JetBrains plugin, and CLI. The CLI binary is called `kilo`. Source: `https://github.com/Kilo-Org/kilocode` (TypeScript, open source). The CLI is a standalone agent (not a VS Code wrapper) — the VS Code extension manages the lifecycle of the same `kilo` CLI binary underneath.

Config files: `~/.config/kilo/opencode.json` (global), `./opencode.json` or `./.opencode/` (project-level). Source: `https://kilo.ai/docs/code-with-ai/platforms/cli`.

### Hook surface

**None exists.** The investigation found no hook or lifecycle event system that external tools can subscribe to.

Evidence:
1. **Feature request #5827** (`https://github.com/Kilo-Org/kilocode/issues/5827`, opened 2026-02-12): Explicitly requests "session lifecycle hooks/API" for third-party tool integration. The request describes the absence as a gap and proposes options (config-based hooks, OpenCode-style plugin, git-like CLI hooks). Status: open, no assignees, no milestone, no maintainer response as of research date (2026-04-29).

2. **AGENTS.md** does not mention any hook, lifecycle, or plugin API for session events.

3. **Official CLI docs** (`https://kilo.ai/docs/code-with-ai/platforms/cli`) describe: multi-model support, agent modes, MCP servers, plugin installation via `kilo plugin <module>`. No lifecycle hook or command-execution hook mechanism is documented.

4. **`opencode.json` config** supports: provider auth, MCP server config, instructions key. No hooks section.

5. **Internal architecture note:** DeepWiki analysis of `Kilo-Org/kilocode` confirms an internal event bus (`MessageV2.Event.PartUpdated`) used to stream tool calls and text to stdout — but this is internal, not exposed as a hook surface to external processes.

6. The existing ArgusDev `kilocode.ts` adapter has no `detectionStrategy` and no `generateHookConfig` — consistent with there being nothing to hook.

**The only post-hoc data access is `kilo export [sessionID]`** — a command to export session transcript after the fact, not a lifecycle event system. Source: issue #5827 description.

### Confidence levels

| Claim | Confidence |
|---|---|
| No external hook/lifecycle event system exists | VERIFIED (cross-checked: official docs silent, open feature request confirming absence, no source-level evidence found) |
| CLI binary name is `kilo` | DOCUMENTED (AGENTS.md, kilo.ai docs) |
| Session data lives at `~/.kilocode/cli/global/tasks/*.json` | VERIFIED (confirmed by existing `kilocode.ts` adapter in ArgusDev which reads this path) |
| PTY regex is the only viable approach | VERIFIED (no hook surface + feature request confirms gap) |

### Recommendation

**DIFFERENT APPROACH — PTY regex only.**

No hook surface is available. No hook implementation can be written. The existing PTY-based fallback is the only option until Kilocode implements the feature requested in issue #5827.

Specific gap to track: issue #5827 is the upstream feature request that would unblock hook-based detection. If that issue progresses (maintainer response, milestone, PR), re-evaluate.

No `waiting_input` event exists either. Current PTY regex in `stateDetection.ts` does not have a `detectKilocodeState()` — the adapter falls through to `currentState` fallback. This is a separate but related gap worth noting.

---

## 4. Summary

| Agent | Hook System | Config Location | idle signal | busy signal | waiting_input | Recommendation |
|---|---|---|---|---|---|---|
| GitHub Copilot CLI | YES (8 events, GA Feb 2026) | `.github/hooks/*.json` in worktree | `agentStop` | `userPromptSubmitted`, `preToolUse` | none — PTY only | **PROCEED** (partial hook + PTY for waiting_input) |
| Kilocode | NO (feature requested, not shipped) | n/a | n/a | n/a | n/a | **DIFFERENT APPROACH** (PTY regex only; monitor #5827) |

---

## 5. Open Questions

1. **Copilot CLI `agentStop` smoke test:** Does `agentStop` reliably fire in CLI PTY sessions (as opposed to non-interactive `-p` mode)? Has not been tested live. Recommend: test before shipping — install `gh copilot`, write a minimal hooks file, run a session, confirm curl fires.

2. **Copilot CLI hooks with interactive sessions vs `-p` mode:** ArgusDev spawns agents in PTY. Does the Copilot CLI honor `.github/hooks/` when run in PTY vs `-p` invocation? Undocumented.

3. **Copilot CLI `agentStop` input schema:** The exact stdin JSON for `agentStop` was not confirmed from docs. Likely `{timestamp, cwd}` but not verified — doesn't matter for ArgusDev (we ignore stdin; only fire and forget POST).

4. **Kilocode PTY patterns:** `detectKilocodeState()` does not exist in `stateDetection.ts`. The Kilocode adapter falls back to preserving current state. Are there observable PTY patterns for busy/idle/waiting_input in Kilocode's TUI that could be used to write a regex detector? Not researched — separate from hook research scope.

5. **Kilocode issue #5827 progress:** No maintainer engagement as of 2026-04-29. Worth monitoring quarterly (same cadence as Cursor's td-3baf11).

---

## Sources

- https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks
- https://docs.github.com/en/copilot/reference/hooks-configuration
- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks
- https://docs.github.com/en/copilot/tutorials/copilot-cli-hooks
- https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-hooks
- https://bartwullems.blogspot.com/2026/03/github-copilot-cli-tips-tricks-part-4.html
- https://smartscope.blog/en/generative-ai/github-copilot/github-copilot-hooks-guide/
- https://github.com/github/copilot-cli/issues/1157
- https://github.com/Kilo-Org/kilocode/issues/5827
- https://github.com/Kilo-Org/kilocode
- https://github.com/Kilo-Org/kilocode/blob/main/AGENTS.md
- https://kilo.ai/docs/code-with-ai/platforms/cli
- https://deepwiki.com/Kilo-Org/kilocode/3-core-features
- src/adapters/githubCopilot.ts (this repo)
- src/adapters/kilocode.ts (this repo)
- src/adapters/stateDetection.ts (this repo)
- src/utils/hookSettings.ts (this repo)
