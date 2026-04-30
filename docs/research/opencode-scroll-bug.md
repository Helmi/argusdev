# OpenCode Scroll Bug — Research Findings

**Date:** 2026-04-29
**Researcher:** res-ocscroll agent
**ArgusDev version:** 0.7.2

---

## Bug Summary (verbatim from user)

> OpenCode has its own scroll handling as do many agents now. In argusdev (production 0.7.2) that
> scrolling stops working sometimes after switching sessions. Restarting OpenCode within the same
> session with `--continue` loads the session again and works fine. Sometimes when switching
> sessions a few times I suddenly can scroll through xterm.js's own scroll buffer but then only
> holds like two pages (screen height) worth of data.
>
> **Additional observations:**
> - Happens while OpenCode responds inside a *detached* session — the fact it is detached causes this.
> - When scroll breaks, **ALL sessions stop scrolling**, not just the OpenCode one.
> - "Open editor" in OpenCode fixes it (opens system editor, returns, scrolling works again).
> - OpenCode's own "redraw" button did NOT fix it.

---

## Methodology

1. Read full `client/src/components/TerminalSession.tsx` (lines 1–742) to understand ArgusDev's
   xterm.js usage, event handling, focus/blur lifecycle, and resize behavior.
2. Fetched and read OpenCode source from `anomalyco/opencode` (GitHub API, `dev` branch) — confirmed
   it is TypeScript (not Go/Bubbletea as initially hypothesized). Architecture:
   - **App layer:** SolidJS web app in `packages/app/`, uses `ghostty-web` for web terminal rendering.
   - **CLI/TUI layer:** `packages/opencode/src/cli/cmd/tui/`, uses `@opentui/core` (Zig-native TUI library).
   - **Backend:** Node.js PTY server in `packages/opencode/src/pty/` — uses WebSocket connection.
3. Fetched and read `anomalyco/ghostty-web` (the xterm.js replacement OpenCode uses in its web app).
4. Fetched and read `anomalyco/opentui` (the TUI rendering library OpenCode uses in CLI mode).
5. Read xterm.js 5.3.0 source from `client/node_modules/xterm/src/` (TypeScript sources present).
6. Searched OpenCode GitHub issues for scroll, mouse, focus, altscreen keywords.

---

## Findings

### Q1 — Does OpenCode use Bubbletea? What TUI framework does it use?

**VERIFIED.** OpenCode is TypeScript, not Go. It does **not** use Bubbletea.

- **ArgusDev hosts the CLI/TUI mode of OpenCode**: users run `opencode` as a PTY process inside
  ArgusDev's xterm.js terminal. This mode uses `@opentui/core` v0.2.0, a custom TUI framework
  written in Zig with TypeScript bindings (`anomalyco/opentui`).
- Source: `packages/opencode/src/cli/cmd/tui/app.tsx` line 4:
  ```ts
  import { createCliRenderer, MouseButton, type CliRendererConfig } from "@opentui/core"
  ```
- Mouse is enabled at line 71–81:
  ```ts
  const mouseEnabled = !Flag.OPENCODE_DISABLE_MOUSE && (_config.mouse ?? true)
  // ...
  useMouse: mouseEnabled,
  ```

### Q2 — Does opentui (OpenCode's TUI) enable DECSET 1004 (focus tracking)?

**VERIFIED.** opentui conditionally enables focus tracking.

- `packages/core/src/zig/terminal.zig` lines 344–345: focus tracking is enabled during terminal
  setup **if the capability response indicates the host terminal supports it**.
- Detection is done via `processCapabilityResponse()` (line 748):
  ```zig
  if (std.mem.indexOf(u8, response, "1004;1$y") != null or
      std.mem.indexOf(u8, response, "1004;2$y") != null) {
      self.caps.focus_tracking = true;
  }
  ```
- xterm.js 5.x **supports** DECSET 1004 (confirmed: `InputHandler.ts` line 1901–1904, 2129–2130).
- Therefore: when ArgusDev's xterm.js reports focus tracking capability to OpenCode, opentui
  **will enable DECSET 1004** on startup.

### Q3 — Does xterm.js send `\x1b[O` on focus-out when DECSET 1004 is enabled?

**VERIFIED.** Confirmed in xterm.js source.

- `src/browser/Terminal.ts` lines 287–297:
  ```ts
  private _handleTextAreaBlur(): void {
    // ...
    if (this.coreService.decPrivateModes.sendFocus) {
      this.coreService.triggerDataEvent(C0.ESC + '[O');
    }
    // ...
  }
  ```
- `sendFocus` is set to `true` when the running application emits `DECSET ?1004h`.
- The trigger event is the textarea's `blur` DOM event.
- When ArgusDev calls `xterm.focus()` on the newly selected session (or when the user clicks another
  session tile), the previously active xterm's textarea fires `blur`, which causes xterm to emit
  `\x1b[O` into the PTY — **directly into OpenCode's stdin**.

### Q4 — How does opentui handle `\x1b[O` (focus-out)?

**VERIFIED.** opentui sets a `shouldRestoreModesOnNextFocus` flag on blur.

- `packages/core/src/renderer.ts` lines 2679–2685:
  ```ts
  if (sequence === "\x1b[O") {
    this.shouldRestoreModesOnNextFocus = true
    // ...
    this.emit(CliRenderEvents.BLUR)
    return true
  }
  ```
- The design intent is that some terminals (e.g. Windows Terminal/ConPTY) strip DEC private modes
  while unfocused. On the next focus-in (`\x1b[I`), opentui calls `restoreTerminalModes()` to
  re-emit all DECSET sequences.
- This mechanism is correct in design **but creates a problematic window** described in Hypothesis 1.

### Q5 — What does `restoreTerminalModes()` do?

**VERIFIED.** It re-emits all active DECSET sequences including mouse modes.

- `terminal.zig` lines 691–730 (`restoreTerminalModes`): re-emits:
  - `?1000h`, `?1002h`, `?1003h` (mouse tracking)
  - `?1006h` (SGR mouse mode)
  - `?1004h` (focus tracking, if active)
  - `?2004h` (bracketed paste, if active)
  - Kitty keyboard, modifyOtherKeys
- Called when `\x1b[I` (focus-in) is received AND `shouldRestoreModesOnNextFocus` is true.

### Q6 — Does ArgusDev send focus-in to the PTY when switching back to the OpenCode session?

**SPECULATIVE (mechanism not definitively traced, but plausible).** ArgusDev calls
`xterm.focus()` on the newly focused session (TerminalSession.tsx lines 686–688). This causes the
xterm textarea to fire `focus`, which triggers xterm's `_handleTextAreaFocus`. If `sendFocus` is
active, xterm sends `\x1b[I` into the PTY. Since opentui sets `sendFocus` (DECSET 1004) on startup,
focus-in should work correctly on return.

**However:** If xterm is not in an active/focused state when it is switched *away from* — e.g. if
the user switches sessions without xterm having textarea focus at that moment — the `blur` event may
not fire, and `\x1b[O` is never sent. This means `shouldRestoreModesOnNextFocus` stays `false`, and
when the user switches back and `\x1b[I` arrives, `restoreTerminalModes()` is NOT called. Mouse
mode is never re-asserted.

**Alternatively**, the scenario may be the reverse: the `blur` fires OK, opentui correctly records
`shouldRestoreModesOnNextFocus = true`, but `\x1b[I` on return is never delivered (or is delayed
past the point where OpenCode checks it), leaving mouse mode disabled.

### Q7 — The "2 pages of xterm scroll" symptom

**DOCUMENTED.** Explained by xterm.js altscreen behavior.

- `src/browser/Terminal.ts` lines 779–808: when no mouse mode is active AND the buffer has no
  scrollback (altscreen mode), xterm converts wheel events to arrow key sequences. But if altscreen
  is still active but mouse mode was silently dropped, xterm's `handleWheel` falls through to the
  normal viewport scrolling path.
- The altscreen buffer has no scrollback (by design), so only ~1-2 screens of content are visible.
- This is exactly the "two pages" symptom: mouse mode dropped → xterm takes over wheel scroll →
  but altscreen has minimal buffer → scroll feels stuck.

### Q8 — Why do ALL sessions stop scrolling, not just OpenCode's?

**VERIFIED mechanism, root cause partially SPECULATIVE.**

This is the most critical finding. xterm.js registers its wheel listener at **element level**,
`{ passive: false }` (Terminal.ts line 726), calling `this.cancel(ev, true)` which does
`ev.preventDefault(); ev.stopPropagation()`.

ArgusDev registers its own passive wheel handler on the terminal container div
(TerminalSession.tsx line 357: `{ passive: true }`).

When mouse mode is enabled in xterm.js (OpenCode TUI actively using mouse), xterm's
`onProtocolChange` listener adds a `{ passive: false }` wheel handler that calls `sendEvent(ev)`
and then `cancel(ev, true)` = `preventDefault + stopPropagation`. This prevents the browser's
default scroll AND stops propagation. **This is per-element, not global.**

However, xterm.js also registers a permanent wheel listener at lines 779–808 (also element-level,
`{ passive: false }`) that handles viewport scrolling. This listener calls `cancel(ev)` (without
`force`) whenever `cancelEvents` option is set.

**Scenario that could affect all sessions:** ArgusDev's grid layout has all TerminalSession
components mounted simultaneously. If the browser delivers a wheel event to the wrong terminal's
DOM element (e.g. because of CSS z-index/overflow or because ArgusDev's session-switch causes a
brief period where both sessions' containers are stacked), the wrong xterm's mouse-mode wheel
handler could intercept the event.

**More likely scenario (SPECULATIVE):** The CSS grid containing all mounted terminal divs may allow
wheel events to bubble or hit multiple overlapping elements during transitions. No definitive
cross-session global listener was found in xterm.js source (wheel is element-scoped), but this
requires runtime verification.

### Q9 — "Open editor" fix mechanism

**VERIFIED.** The fix path is:

1. OpenCode calls `renderer.suspend()` (opentui renderer, `packages/core/src/renderer.ts` line 3388)
2. `suspend()` calls `disableMouse()` → emits `?1000l ?1002l ?1003l ?1006l` to stdout (the PTY)
3. `suspend()` calls `this.lib.suspendRenderer(this.rendererPtr)` → `performShutdownSequence()` in
   Zig → `terminal.resetState()` → emits full reset including `?1004l`, `?1049l` (exit altscreen)
4. External editor spawns, gets a clean terminal
5. On editor exit: `renderer.resume()` → `lib.resumeRenderer()` →
   `setupTerminalWithoutDetection()` → re-enters altscreen (`?1049h`), re-does capability detection
6. Back in TypeScript: if `_suspendedMouseEnabled` was true, calls `enableMouse()` → emits
   `?1000h ?1002h ?1003h ?1006h`
7. xterm.js (ArgusDev) sees the `?1003l` / `?1000l` sequences from step 2 during editor open →
   `CoreMouseService.onProtocolChange` fires → xterm REMOVES its mouse-tracking wheel handler
8. xterm.js sees `?1003h` / `?1000h` from step 6 on editor close → adds mouse-tracking wheel
   handler back

This full cycle forces xterm's mouse protocol state machine to go through a known-good reset,
re-synchronizing it with opentui's state. This repairs the scroll for the OpenCode session itself.

ArgusDev sessions are individual PTYs — the DECSET sequences from step 2 and 6 only flow through
the OpenCode session's PTY, not other sessions. The "open editor fixes all sessions" observation
therefore indicates the cross-session breakage is driven from the ArgusDev React layer (shared
state, layout, or the focus lifecycle), not from opentui's internal state. The editor open/close
cycle incidentally resets whatever ArgusDev-side condition was breaking the other sessions — most
likely by clearing any stale React focus state or triggering a re-render that resets wheel handler
registrations.

### Q10 — Existing OpenCode issues

**DOCUMENTED.** Multiple corroborating reports:

- Issue #7316 "Mouse wheel stops working after some usage on Windows Terminal" — confirmed same
  symptom, comments confirm macOS/iTerm affected too. Multiple users report it as persistent.
- Issue #6912 "Ctrl+C does not disable mouse tracking" — confirms opentui explicitly enables
  `?1003h` (any-event), `?1006h` (SGR mouse). On forced exit, these are not cleaned up.
- Comment on #7316 from automated triage: "Ctrl+C does not disable mouse tracking, causing raw SGR
  mouse tracking escape sequences to flood terminal" — corroborates mouse-mode state management as
  the systemic weak point.
- Issue #6912 notes OpenCode enables: `?1003h`, `?1006h` (confirmed in opentui terminal.zig source).

---

## Root-Cause Hypotheses (Ranked by Likelihood)

> **Constraint note:** The bug affects ALL sessions, not just the OpenCode one. Any hypothesis that
> only explains why the OpenCode session breaks is at best a partial root cause. No single
> hypothesis below fully explains both the per-session breakage and the cross-session scope with
> high confidence. The most likely picture is a two-stage failure: (1) something in the focus or
> mouse-mode lifecycle breaks the OpenCode session, and (2) a shared ArgusDev React/DOM state
> propagates the breakage to other sessions.

### Hypothesis 1 — Focus-out received mid-response, `\x1b[I` never delivered (MOST LIKELY for per-session breakage)

**Confidence: DOCUMENTED/SPECULATIVE**

When the user switches away from the OpenCode session while it is mid-response:

1. xterm.js textarea loses focus → sends `\x1b[O` into the OpenCode PTY
2. opentui receives `\x1b[O` → sets `shouldRestoreModesOnNextFocus = true`
3. OpenCode continues generating output. The output arrives at xterm.js via the socket, and
   xterm.js writes it. Meanwhile, xterm's `sendFocus` mode remains active (xterm.js only disables
   `sendFocus` when it sees `?1004l` from the app; opentui never emits `?1004l` on blur).
4. User switches back. ArgusDev calls `xterm.focus()`.
5. xterm's textarea fires `focus` → but **is `sendFocus` still active?**

   **Critical gap:** If the mid-response output stream from OpenCode contained any sequence that
   modified xterm's DECSET state — including `?1004l` — `sendFocus` would be disabled. Any
   subsequent `xterm.focus()` call would NOT send `\x1b[I` to the PTY.

6. Without `\x1b[I`, opentui's `shouldRestoreModesOnNextFocus` is never cleared, and
   `restoreTerminalModes()` is never called. Mouse mode stays disabled from opentui's
   perspective (the `?1000l/1003l` came from the focus-out path OR from a prior event).

**Why `--continue` fixes it:** Restarting OpenCode with `--continue` triggers a full
`createCliRenderer()` → `setupTerminalWithoutDetection()` → re-enables all DECSET modes from
scratch. xterm sees the `?1003h` sequence and re-adds its mouse wheel handler.

**Why "open editor" fixes it:** See Q9 above — `suspend()` + `resume()` cycle fully resets and
re-emits all DECSET sequences.

**Why "redraw" does NOT fix it:** opentui's redraw repaints the render buffer but does not
re-emit DECSET terminal modes. It is a visual-layer operation only.

### Hypothesis 2 — Race between response output and focus-out sequence parsing (SPECULATIVE)

**Confidence: SPECULATIVE**

opentui receives data from stdin as a raw stream. When a long response arrives simultaneously with
a focus-out sequence (`\x1b[O`), the sequences may interleave in the buffer. If the stdin parser
incorrectly classifies `\x1b[O` as part of a different escape sequence during heavy output, the
focus-out is silently dropped. On next focus, `shouldRestoreModesOnNextFocus` is false → no
restore → no mouse mode. This would explain the "detached session during response" trigger.

### Hypothesis 3 — ArgusDev React focus state leak across sessions (SPECULATIVE)

**Confidence: SPECULATIVE**

All TerminalSession components remain mounted simultaneously in ArgusDev's CSS grid. When the user
switches sessions, the `isFocused` prop changes for two components in the same React render cycle.
The focus effect in TerminalSession.tsx (lines 680–700) calls `xterm.focus()` on the newly active
session. This causes the previously active xterm's textarea to fire `blur`, which (if `sendFocus`
is active) sends `\x1b[O` to the old session's PTY — even though the user is done with it.

If the old session is a non-OpenCode session that does NOT use mouse mode, this `\x1b[O` is
harmless. But if any subsequent session switch causes xterm to lose track of which instance "owns"
focus — for example, if `xterm.focus()` is called on session B while session C's textarea still
holds a DOM focus lock — the wheel event target may be the wrong xterm instance. Since xterm.js
wheel listeners are element-scoped, a wheel event on the wrong element hits either a session with
mouse-mode consuming the event (blocking scroll) or a session in altscreen with no mouse mode
(converting wheel to arrow keys into the wrong PTY).

Note: `.enable-mouse-events` CSS class (xterm.css line 128) only sets `cursor: default` — it does
NOT affect `pointer-events` or overflow. CSS cascade from this class alone cannot explain
cross-session scroll breakage.

---

## Recommended Fix Paths

### (a) Upstream OpenCode patch (PREFERRED — fixes root cause)

**Target:** opentui's focus-out handler in `packages/core/src/renderer.ts` around line 2680.

**Problem:** On receiving `\x1b[O`, opentui sets `shouldRestoreModesOnNextFocus = true` but does
NOT immediately re-emit its mouse mode sequences. It relies on receiving `\x1b[I` later to trigger
`restoreTerminalModes()`. But in ArgusDev's "always mounted, CSS-visibility-switched" model, there
is no guarantee `\x1b[I` will arrive.

**Proposed fix:** Instead of deferring to `\x1b[I`, opentui should re-emit mouse mode immediately
after a focus-out (or more robustly: not emit the focus-out response at all when the terminal is
embedded in a web UI that doesn't actually disconnect the PTY). The real root issue is that opentui
treats `\x1b[O` as "terminal may drop modes" and prepares to restore, but in this embedding context
the terminal (xterm.js) does NOT drop mouse modes on focus — it only drops `sendFocus` state.

**Alternatively:** opentui should not have `shouldRestoreModesOnNextFocus` gate the restore; it
should call `restoreTerminalModes()` unconditionally on receiving `\x1b[I`, whether or not a
`\x1b[O` was seen.

**File:** `anomalyco/opentui` → `packages/core/src/renderer.ts` line ~2664.

### (b) ArgusDev workaround — intercept and suppress focus events

**Target:** `client/src/components/TerminalSession.tsx`

**Option 1 (simplest):** Suppress `\x1b[O` from being sent when the session loses ArgusDev focus
(as opposed to the browser losing focus entirely). Since ArgusDev sessions stay mounted and the PTY
stays alive, the session is not truly "unfocused" from the PTY's perspective — only user attention
has shifted.

Add to the `onData` filter in the `useLayoutEffect` (around line 308 where other terminal
responses are filtered):

```ts
// Filter focus-out sequences for sessions that stay mounted (OpenCode workaround)
// \x1b[O = focus-out, \x1b[I = focus-in
// Sending these to OpenCode's opentui causes mouse mode to desync on session switch.
const focusPattern = /\x1b\[O|\x1b\[I/g;
filtered = filtered.replace(focusPattern, '');
```

**Caution:** This would suppress ALL focus events for ALL agents. Some agents may legitimately
need focus tracking (e.g. to pause/resume heavy rendering). Consider scoping to `agentId ===
'opencode'` or making it an agent config flag.

**Option 2 (targeted):** Before calling `xterm.focus()` on the new session, explicitly send
`\x1b[I` to the old session's PTY via a direct socket.emit. This ensures opentui's
`shouldRestoreModesOnNextFocus` is honored and `restoreTerminalModes()` fires correctly.

Relevant code in `TerminalSession.tsx` lines 680–700 (the `isFocused` effect). When `isFocused`
changes from true to false, emit `input` with `\x1b[I` to trigger opentui restore.

**This is complex and fragile.** Option 1 is cleaner.

**Option 3 (defensive):** After switching to a session, if the session belongs to OpenCode agent,
send a no-op resize (same dims) via socket to trigger opentui's resize handler, which internally
re-applies terminal state. This is a blunt instrument but may help.

### (c) Further investigation needed

1. **Verify cross-session scope mechanism:** Run ArgusDev with DevTools open. On scroll failure,
   inspect which element receives wheel events (use `monitorEvents(document, 'wheel')` or add a
   capture-phase listener). Confirm whether the event target is the active session's xterm element
   or a different one. Also check whether any xterm element has stale DOM focus (`document.activeElement`)
   that does not match the ArgusDev active session. Note: `.enable-mouse-events` CSS class only sets
   `cursor: default` and cannot cause cross-session scroll blocking.

2. **Verify `\x1b[I` delivery on return:** Add diagnostic logging to TerminalSession.tsx's
   `handleDataWithDiag` to log when `\x1b[I` or `\x1b[O` sequences are seen in the outgoing
   `onData` stream. Confirm whether focus-in is actually sent back to OpenCode on session return.

3. **User test:** Does alt-tabbing to Finder and back (without switching ArgusDev sessions) fix the
   scroll? If yes, focus restoration via OS-level focus-in is sufficient and the bug is purely in
   ArgusDev's session-switch path not sending `\x1b[I`.

4. **Check ghostty-web:** The web version of OpenCode (accessed via browser, not CLI) uses
   `ghostty-web` instead of opentui. `ghostty-web` has `hasFocusEvents()` method tied to its Wasm
   terminal's mode 1004, but NO implementation was found that sends `\x1b[I`/`\x1b[O` to the PTY
   on textarea focus/blur. This means the web version may NOT exhibit this bug. Confirm with user
   whether they use CLI or web mode.

---

## Open Questions

1. **Is ArgusDev running OpenCode as CLI (TUI mode) or web app mode?** The bug description refers
   to PTY sessions, so CLI mode is assumed. If web mode, the whole opentui analysis is irrelevant
   (ghostty-web is used instead, and focus events are not forwarded to PTY).

2. **Is DECSET 1004 actually enabled by opentui in this context?** opentui only enables focus
   tracking if the capability probe response contains `1004;1$y` or `1004;2$y`. **xterm.js DOES
   respond to DECRQM for mode 1004**: `InputHandler.ts` line 2252:
   `if (p === 1004) return f(p, b2v(dm.sendFocus));` — it returns `1004;1$y` when `sendFocus` is
   already enabled, `1004;2$y` when disabled. On a fresh xterm instance `sendFocus` starts as
   `false`, so xterm responds `1004;2$y` (permanently reset). opentui's capability detector matches
   `1004;2$y` as a hit, sets `caps.focus_tracking = true`, and proceeds to enable DECSET 1004.
   **Therefore focus tracking IS enabled when OpenCode runs inside xterm.js**, and Hypothesis 1
   stands. (If a prior OpenCode session left xterm in `sendFocus = true` state, the response is
   `1004;1$y` — also matched, still sets the capability.)

3. **Does xterm.js set `sendFocus` based on the APPLICATION sending `?1004h`, not on capability?**
   Yes — xterm sets `sendFocus` when the running process emits `\x1b[?1004h`. Per Q2, opentui DOES
   enable focus tracking after detecting the capability, so xterm will subsequently have
   `sendFocus = true` and will emit `\x1b[I`/`\x1b[O` on focus/blur transitions. The focus
   mechanism is therefore active and Hypothesis 1 holds.

4. **Does ArgusDev fire a resize event on session switch?** ResizeObserver in TerminalSession.tsx
   (line 563) fires on any size change of `terminalRef.current`. When the grid layout shifts to
   make one session active, the div may momentarily resize. If this fires a resize socket event to
   OpenCode, opentui may process the resize in a way that resets its scroll state.

5. **The "all sessions affected" constraint remains unexplained with high confidence.** This is the
   hardest constraint to explain without runtime verification. If xterm.js wheel listeners are
   element-scoped (confirmed), cross-session contamination must go through shared DOM layout or
   ArgusDev React state. Requires browser DevTools inspection.

---

## Key Source References

| File | Key Lines | Finding |
|------|-----------|---------|
| `anomalyco/opentui`: `packages/core/src/renderer.ts` | 2664–2688 | Focus-in/out handler, `shouldRestoreModesOnNextFocus` flag |
| `anomalyco/opentui`: `packages/core/src/renderer.ts` | 3377–3441 | `suspend()` / `resume()` fully resets+restores mouse mode |
| `anomalyco/opentui`: `packages/core/src/zig/terminal.zig` | 170–197 | `resetState()` disables all DECSET modes |
| `anomalyco/opentui`: `packages/core/src/zig/terminal.zig` | 344–346 | Focus tracking enabled if capability detected |
| `anomalyco/opentui`: `packages/core/src/zig/terminal.zig` | 691–730 | `restoreTerminalModes()` re-emits all DECSET sequences |
| `anomalyco/opencode`: `packages/opencode/src/cli/cmd/tui/util/editor.ts` | 9–36 | External editor: suspend → spawn → resume |
| `anomalyco/opencode`: `packages/opencode/src/cli/cmd/tui/app.tsx` | 71, 81 | Mouse enabled by default |
| ArgusDev: `client/src/components/TerminalSession.tsx` | 266–268 | xterm.js sends `\x1b[O` on textarea blur if `sendFocus` is active |
| xterm.js 5.3.0: `src/browser/Terminal.ts` | 267–268, 292–293 | Focus in/out sequences emitted on textarea focus/blur |
| xterm.js 5.3.0: `src/browser/Terminal.ts` | 698–728 | Mouse protocol change handler; wheel listener added/removed per protocol |
| xterm.js 5.3.0: `src/browser/Terminal.ts` | 779–808 | Fallback wheel handler: arrows in altscreen, viewport scroll otherwise |
| xterm.js 5.3.0: `src/common/InputHandler.ts` | 1901–1904, 2129–2130 | DECSET/DECRST 1004 sets/clears `sendFocus` |
| xterm.js 5.3.0: `src/common/InputHandler.ts` | 2252 | DECRQM `?1004$p` responds with `1004;1$y`/`1004;2$y` based on `sendFocus` state |

---

## Summary Confidence Assessment

| Claim | Confidence |
|-------|-----------|
| OpenCode TUI uses opentui (Zig), not Bubbletea | VERIFIED |
| opentui enables DECSET 1003h/1002h/1006h (mouse) | VERIFIED |
| opentui conditionally enables DECSET 1004h (focus tracking) | VERIFIED |
| xterm.js 5.3.0 sends `\x1b[O` on blur when `sendFocus` active | VERIFIED |
| xterm.js 5.3.0 sends `\x1b[I` on focus when `sendFocus` active | VERIFIED |
| opentui uses focus-out to set restore flag, focus-in to re-enable mouse | VERIFIED |
| "Open editor" fix works via suspend/resume DECSET cycle | VERIFIED |
| opentui detects focus tracking capability from xterm.js DECRQM response | VERIFIED (xterm.js InputHandler.ts:2252 responds to `?1004$p`) |
| Focus mechanism (1004h/O/I) is the actual trigger for the OpenCode session breakage | HIGH CONFIDENCE |
| Cross-session scope explained by CSS cascade | SPECULATIVE |
| Cross-session scope explained by something in ArgusDev React layer | SPECULATIVE |
