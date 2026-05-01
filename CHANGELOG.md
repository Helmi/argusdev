# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [0.8.0](https://github.com/Helmi/argusdev/compare/v0.7.2...v0.8.0) (2026-05-01)

The first release where state detection isn't a buffer-scraping hack on most agents. Codex, Gemini, OpenCode and Pi all moved to hook-based detection (Claude was already there in 0.7.0), so busy/idle/waiting transitions now arrive directly from the agent's lifecycle instead of being inferred from terminal output. The task board grew a graph view with parent/child and dependency edges, a "nudge" primitive lets you type into a running session without stealing focus (now used by reject-loop and integration alerts), and TUI sessions self-heal on re-attach instead of leaving you to hit Refresh. Mobile and per-project routing got a stack of fixes that have been overdue.


### Features

#### State detection
* **hooks:** hook-based state detection for **Codex** ([2434fc9](https://github.com/Helmi/argusdev/commit/2434fc9269374d93276d7ef4618d11da35514f74)) — generated via `generateHookConfig`, replaces buffer-scraping for accurate busy/idle on Codex sessions.
* **adapters:** hook-based state detection for **Gemini CLI** ([d3d1938](https://github.com/Helmi/argusdev/commit/d3d19388d29a83c164e666269c3d1e6bb9ad3421)) — installs into `.gemini/settings.json` and merges with existing user hooks instead of overwriting.
* **hooks:** hook-based state detection for **OpenCode** via a native plugin ([cb14009](https://github.com/Helmi/argusdev/commit/cb14009f69f8e6846d300ba6678497b3194516f9)).
* **adapters:** **Pi** hook-based state detection with PTY fallback ([b194220](https://github.com/Helmi/argusdev/commit/b19422004bc28149d9edfd226e209228b2756b1e)) — partial-hook coverage falls back to terminal heuristics for transitions Pi doesn't yet emit.
* **opencode:** detect question-tool `waiting_input` via the `question.asked` bus event ([2134930](https://github.com/Helmi/argusdev/commit/21349300ab9aa718d2aa5befbb8d7dfe57939150)).

#### Task board
* **webui:** graph view for the task board ([ab5c4c2](https://github.com/Helmi/argusdev/commit/ab5c4c2fdfe09c07a1763c6eb2a97c14b465e8df)) — dagre-laid-out parent/child and dependency edges, search highlight, click-to-open. Theme-aware controls and proper keyboard a11y on nodes ([137bc99](https://github.com/Helmi/argusdev/commit/137bc998f1121fae837445c54a5bdc20a570d95e)).
* **webui:** "Active only" toggle in graph view ([82ba4c2](https://github.com/Helmi/argusdev/commit/82ba4c28bbc4a590f69b4f8d81744832295bb05f), [aaf7108](https://github.com/Helmi/argusdev/commit/aaf7108b54e9a2f70cc92e24183533c8b0063c34)) — hides every closed node and its edges by default; closed work renders subdued (no green-border accent) when shown.
* **taskboard:** reject-loop pills and nudges ([3e82816](https://github.com/Helmi/argusdev/commit/3e82816b99e75f2e415151123f8e0727474bdede)) — when the same rejection fingerprint repeats, the task gets a pill and the implementer session gets a nudge.

#### Sessions
* **webui:** nudge primitive — type text into a running session, busy-aware ([736c7f9](https://github.com/Helmi/argusdev/commit/736c7f9954def6811d029e6bea5d9a5d8f036d09)) — sends bracketed-paste-safe text to the PTY without stealing focus or interleaving with active output.
* **webui:** integration nudge — surface unmerged worktrees on non-worktree sessions ([ecabf07](https://github.com/Helmi/argusdev/commit/ecabf0716019699dcbacb587ac63eb4ea9a3f873)) — when a session for the main branch ignores work that's still on a worktree branch, that's flagged in the sidebar with a nudge.
* **webui:** auto-redraw TUI sessions on re-attach ([94ed98d](https://github.com/Helmi/argusdev/commit/94ed98d3348defa06ee5e32e4723601040536a8f)) — fires the same `cols-1 → cols` SIGWINCH cycle as the manual refresh button about 350 ms after the replay payload lands. Plain shell sessions are skipped.

#### Agent profiles
* **agents:** `__omit__` sentinel choice value ([545c516](https://github.com/Helmi/argusdev/commit/545c51651ee7eec40bf01c1d8440d6658dd5abaf)) — a profile option choice with value `__omit__` suppresses the CLI flag entirely. Pi's "All tools (no restriction)" choice now uses it so Pi runs without `--tools`, allowing every tool Pi knows about. Custom profiles can use the same trick.


### Bug Fixes

#### Conversation & transcripts
* **api:** re-discover agent transcripts when the initial window times out ([8d8b356](https://github.com/Helmi/argusdev/commit/8d8b356d328ff53f88befefc7b4fb4046fc6d8a1)).
* **adapters:** correct Codex/Gemini transcript parsing; surface "unsupported" for cline ([b8f2c44](https://github.com/Helmi/argusdev/commit/b8f2c44f37f9a52de63f704c97417551266b51dc)).
* **adapters:** content-aware dedup for Codex `response_item`/`message` rows ([0246e12](https://github.com/Helmi/argusdev/commit/0246e12bb41fcfa31e57fb68add2a8c950a4421e)).
* **adapters:** filter prompt-blob noise from legacy Codex rows ([d58ac73](https://github.com/Helmi/argusdev/commit/d58ac731d57e55b2ee4475511dca0e7707c8a4bd)) and from the top-level `response_item` envelope shape ([d3b61f1](https://github.com/Helmi/argusdev/commit/d3b61f1341b295dfef08aed49c5a307e106f1e90)).

#### Hook adapters
* **adapters:** merge ArgusDev hooks into an existing `.gemini/settings.json` instead of overwriting ([4a24308](https://github.com/Helmi/argusdev/commit/4a243087b5945c95b2ce9c312017eb767b8c1fc7)).
* **adapters:** strip stale ArgusDev hooks and guard backup on crash-recovery ([1817cc2](https://github.com/Helmi/argusdev/commit/1817cc2a4712642ad5f7fa766b2cbc9818795451)).
* **hooks:** prevent backup-of-backup loss; skip config revert on mid-session edits ([4606385](https://github.com/Helmi/argusdev/commit/46063859e789b4fa204447e9efb6e1bbe0a89b6f)).
* **hooks:** strip ArgusDev hooks on cleanup instead of unlinking the host file ([bba9216](https://github.com/Helmi/argusdev/commit/bba921684cb032935253361d849c759749620466)).
* **hooks:** correct Codex hook schema and preserve user hook files ([297d768](https://github.com/Helmi/argusdev/commit/297d76864d3507fafa452804fbd0aa0b6de365d3)).
* **hooks:** harden backup logic and scope Gemini transcript discovery ([44b70d2](https://github.com/Helmi/argusdev/commit/44b70d2af2158b2a06b46088ab41c6ddd31ba32c)).
* **hooks:** wire `permission.ask` and `session.status` busy to the OpenCode plugin ([0dbe0a6](https://github.com/Helmi/argusdev/commit/0dbe0a6c3dec16a3f6f970d612d414ce7a92ef20)).

#### State detection edge cases
* **state:** Pi no longer over-reports `waiting_input` ([5f392ca](https://github.com/Helmi/argusdev/commit/5f392cab5348373a063c25694f03989a033b3d1f)).
* **adapters:** prevent PTY idle from clobbering hook-delivered busy in Pi sessions ([b180a47](https://github.com/Helmi/argusdev/commit/b180a478a81a37f2eda44b560cdae29c7d7a56e6)).
* **adapters:** cover pure-thinking turns with `turn_start` hook; narrow PTY guard ([2044a81](https://github.com/Helmi/argusdev/commit/2044a8101acbd0c57b33a9a3bcb15c1ee4bd07cc), [df8bfe8](https://github.com/Helmi/argusdev/commit/df8bfe8cddb8c5f175ebf1a10009a19aaae8d49b)).
* **sessions:** trigger auto-approval and restore PTY transitions for hook-based sessions ([877ad57](https://github.com/Helmi/argusdev/commit/877ad57a98ce5d003bbce1b4f606e58373172f7c)).
* **sessions:** narrow partial-hook PTY guard to block idle from pending states; clear `pendingState` on dropped poll tick ([9bb7832](https://github.com/Helmi/argusdev/commit/9bb7832a6be77a2bc12aa1b166321b94c4bd6e3a), [6af81cc](https://github.com/Helmi/argusdev/commit/6af81cc699fb9098e4279ede7bd06186078f8e20)).
* **daemon:** surface orphaned hook events instead of silently dropping ([2006e58](https://github.com/Helmi/argusdev/commit/2006e5849be1284b5b1e805122b0ae7031c5f01a)).

#### Graph view
* **webui,td:** initial pass — graph edges (the missing xyflow `Handle` components left zero edges drawn), board children rendering, node click handler, dark controls ([951db2e](https://github.com/Helmi/argusdev/commit/951db2e7c9789107f64784df3928be097d3340e6)).
* **webui:** modal cross-project lookup; license attribution for vendored deps ([d29532f](https://github.com/Helmi/argusdev/commit/d29532fa837a3c256129b99a31497a0dc7077a74)).
* **webui:** correct empty-state when a project has no visible tasks ([88e87a8](https://github.com/Helmi/argusdev/commit/88e87a864ef95c6ea07fb0a764292402c0960aa6)) and remove redundant overlay message ([c1a6224](https://github.com/Helmi/argusdev/commit/c1a622441f43e18715c9bdaba8069faad88251b4)).

#### Mobile / iOS
* **webui:** mobile paste button for iOS clipboard support ([6dc33fc](https://github.com/Helmi/argusdev/commit/6dc33fc6514c97dcf6f2d7f00b8c4ac9055fb378)) — paste flows through `xterm.paste()` so bracketed-paste mode works correctly ([6836f48](https://github.com/Helmi/argusdev/commit/6836f48d3f3c6e28888a22f0e53447f05ce86664)).
* **webui:** iOS clipboard fallback — textarea modal when `readText` is denied ([65b3953](https://github.com/Helmi/argusdev/commit/65b395358d55710a36780ad2dafd02d1b5816ad5)).
* **webui:** strip Pi cursor-visibility escapes to prevent heartbeat scroll-jump ([980aab1](https://github.com/Helmi/argusdev/commit/980aab1b9b37083611fe60cbdf5f4080a4c4cf64)) — Pi's pi-messenger plugin emits `\x1b[?25l` every ~15 s; xterm refreshes the render area on cursor-state changes, which jumped the viewport.
* **webui:** strip outbound focus events for OpenCode sessions ([e5afd72](https://github.com/Helmi/argusdev/commit/e5afd7221507477c3f6a6d128a459e7d5012ddb2)) — OpenCode mishandled them as a "drop modes" signal.

#### Per-project routing
The whole `currentProject` global was a leak waiting to happen — fetches from one project's task board could land in another. Replaced with explicit `projectPath` plumbed through every layer.
* **webui:** replace global `tdIssues` with per-project `tdIssuesByProject` store ([69d92cb](https://github.com/Helmi/argusdev/commit/69d92cb8e14532d8145fc13dff120768b164565b)).
* **webui:** thread `projectPath` through conversation view, settings, and the task detail modal ([1d249a2](https://github.com/Helmi/argusdev/commit/1d249a22dc3bfcdb522929fbda0ae8f7b6041814), [eda6e7f](https://github.com/Helmi/argusdev/commit/eda6e7f248bc2fb899093b5379d9f19c17c6e72b), [42ceb3e](https://github.com/Helmi/argusdev/commit/42ceb3e693811730311332367c3eaec9b75878c5), [fdccd75](https://github.com/Helmi/argusdev/commit/fdccd75b038e175bf4c2535a28ca84d1170280b8)).
* **webui:** drop `currentProject` from task board routing ([656bcc9](https://github.com/Helmi/argusdev/commit/656bcc9599e11049a36bf3e4ed75c8a4e7009900)) and as live state ([87f94fd](https://github.com/Helmi/argusdev/commit/87f94fd40530ce49f3acab148cb4c5e969486e08)).
* **webui:** gate the task-board icon on per-project `tdEnabled`, not global `tdStatus` ([146dd0d](https://github.com/Helmi/argusdev/commit/146dd0de29a0dc60402e9413e94a7cf68f1e5e12)) and fix stale-ref guard / zero-arg fallout ([316e776](https://github.com/Helmi/argusdev/commit/316e776c0227c0a2bd4513036cefbe3d839a1140), [70bc068](https://github.com/Helmi/argusdev/commit/70bc068de4d342a853088ea212630ef06120204b)).
* **webui:** remove the global td review banner ([7603a0c](https://github.com/Helmi/argusdev/commit/7603a0c1d72516e55d5f68903d0152bd4db982f2)).

#### Misc
* **webui:** route SDK nudges through `/api/sdk-session/:id/message`; guard `sendNudgeSdk` against fetch network errors ([29e66ac](https://github.com/Helmi/argusdev/commit/29e66ac9e40b10f925a749bd34ab8b6cba385e1f), [dde859d](https://github.com/Helmi/argusdev/commit/dde859d3f8de809b97420fd42d4b91c810e99fb2)).
* **reject-loop:** correct detection fingerprint using the log-based `is_rejected` flag ([8ae5f78](https://github.com/Helmi/argusdev/commit/8ae5f78f6d7f1b1ae09d4cad2e34db3cf99a0fab)).
* **integration-nudge:** edge-case fixes from review fold-in ([0d3dc7f](https://github.com/Helmi/argusdev/commit/0d3dc7f3f472f43f2f019ee5578e858a8a9a3fec), [27630df](https://github.com/Helmi/argusdev/commit/27630dfaadc38b47c06f3ba988cb9a4c50b38254)).
* **api:** expose `task.minor` in `renderTaskPromptTemplate` var map ([081b86c](https://github.com/Helmi/argusdev/commit/081b86c9bfb2a36b8123a475499c4bac38c7bcec)).
* **webui:** normalize agent type for behavioral gates ([0529bed](https://github.com/Helmi/argusdev/commit/0529bed703ce9f2cce9865239be9083c3179c36e)) — backend-resolved canonical type drives agent-specific UI behaviors so custom profiles wrapping `claude`/`opencode` still trigger the right code paths.
* **webui:** de-flake graph DOM test, gate td-disabled in the issue-by-id fallback ([6b4283e](https://github.com/Helmi/argusdev/commit/6b4283e48cf3fc1d8fca1c111cd7bf445a33db35)).

### [0.7.2](https://github.com/Helmi/argusdev/compare/v0.7.1...v0.7.2) (2026-04-27)

A polish-and-stability release. The headline ergonomic wins are a manual terminal redraw button (no more browser-resize gymnastics when codex or claude leave gibberish on the screen), a markdown-rendering file preview dialog, clickable file paths in the terminal, and richer td context inside the session sidebar. td integration is still flaky in places — expect more iteration in 0.7.3.


### Features

* **webui:** manual terminal redraw button ([321eaa7](https://github.com/Helmi/argusdev/commit/321eaa7b086f717b0dc17abf0526293e3a4f8185)) — toolbar button (RefreshCw) that nudges xterm and fires a cols-1/cols resize so the TUI agent receives SIGWINCH and repaints; mirrors browser-resize without the friction. Includes replay-window diagnostic logging for session-switch render glitches.
* **webui:** clickable file path links in terminal sessions ([4b80e55](https://github.com/Helmi/argusdev/commit/4b80e554f07f5025c38d61dc5a4b7496129a05df)) — bare paths and markdown-style links in agent output are recognized and clickable; opens the in-app file preview. Path matching extended to handle spaces in segments ([5c14e0f](https://github.com/Helmi/argusdev/commit/5c14e0f09127ba9db25a722fd19361d6d8c03c84)).
* **webui:** file preview dialog with markdown rendering ([86a8424](https://github.com/Helmi/argusdev/commit/86a842410053967089dea098dc048912caa6901a)) — quick-preview any file from the worktree; markdown is rendered, code is syntax-highlighted. Backed by a worktree file endpoint that supports absolute and `~/` paths ([23f4d75](https://github.com/Helmi/argusdev/commit/23f4d75ed966ad67395e71abcd91b550043c4470)).
* **webui:** td task context and workflow actions in session details sidebar ([19827e4](https://github.com/Helmi/argusdev/commit/19827e4ef6be088e3548080ea8e40ead8c0089e0)) — sessions linked to a td issue surface task title, status, and quick workflow actions (start review, etc.) directly in the right sidebar.
* **webui:** per-project "Rev" pill in sidebar project rows ([86de108](https://github.com/Helmi/argusdev/commit/86de10857d0d821ff2fb24b6d39967a64244c353)) — shows count of in-review td tasks per project, scoped to that project's td database.


### Bug Fixes

* **daemon:** persist Claude Code hook settings under configDir, not tmpdir ([bbd6e92](https://github.com/Helmi/argusdev/commit/bbd6e92f556635df3b335268be2ab10ea2d59f75)) — hook settings survived only until the OS cleaned tmp; now stored alongside the rest of the daemon config.
* **daemon:** reconcile worktree list on a timer so external deletions propagate ([99cd709](https://github.com/Helmi/argusdev/commit/99cd709d452157cd1c30dda6f07a4ac39ff034dd)) — worktrees deleted from the shell now disappear from the UI without restarting the daemon.
* **daemon:** isolate dev server from production daemon ([15e69e0](https://github.com/Helmi/argusdev/commit/15e69e0089f9afce0987d6553f4d812a47491353)) — `bun run dev` no longer fights the globally installed daemon over ports/state.
* **api:** scope td review polling by project ([d910064](https://github.com/Helmi/argusdev/commit/d910064a0c03debc7bdc0987029c005ed4c9f1c3)) — review notifications now correctly attribute changes to the originating project instead of leaking across all projects.
* **webui:** changes tab updates on external git changes ([3296a9f](https://github.com/Helmi/argusdev/commit/3296a9fa56c590bdc3e2d276050daca257502ba0)) — file watcher picks up commits and stash operations made outside the UI.
* **webui:** changes tab no longer drops auth or breaks the build with test files ([74f03a6](https://github.com/Helmi/argusdev/commit/74f03a66fda22949486b79217f0e6e6cc55955b1)).
* **webui:** auto-select matching worktree when starting review from task ([bf61c6a](https://github.com/Helmi/argusdev/commit/bf61c6aa91958884a9f59b1917423f6c683767f2)) — "Start review" from a td task picks the worktree whose branch matches the task instead of the default.
* **webui:** render codex and unknown-agent transcripts in ConversationView ([3f54258](https://github.com/Helmi/argusdev/commit/3f5425843fd6bf2f7baae619a21636324c297aa0)) — previously only Claude transcripts rendered; codex and generic agents now show as well.
* **webui:** preserve collapsed project/worktree state across reloads ([aa56a2f](https://github.com/Helmi/argusdev/commit/aa56a2f1071ee86a9adaec63e4bf0164733fb513)).
* **webui:** sidebar rename input gets focus and selects text on open ([0c7f4a9](https://github.com/Helmi/argusdev/commit/0c7f4a9fe23ad6147a23717ac2d4fed41dce127f)).
* **webui:** right sidebar toggle requires only one click ([7299fc2](https://github.com/Helmi/argusdev/commit/7299fc2b3dc7838f82a427bc6d4aa0cc1546af15)).
* **webui:** project-scoped td board fetch + larger session toolbar icons ([6d3c8fc](https://github.com/Helmi/argusdev/commit/6d3c8fc3efd868fd18568452169ef05f3ccab105)) — task board now queries only the active project's td DB; toolbar icons sized up for legibility.
* **webui:** unify taskboard icon and replace info icon with panel toggle ([93cee61](https://github.com/Helmi/argusdev/commit/93cee6155ad96dbc3cf14264861859947c077d91)).
* **webui:** clarify sort setting label ([d2a360d](https://github.com/Helmi/argusdev/commit/d2a360dfcd56c59f7484156768aea2858d2800dd)).
* **webui:** file viewer text wraps instead of overflowing ([885e463](https://github.com/Helmi/argusdev/commit/885e463e86624c74e1fe0eddb7685d4f53374bf1)).
* **ci:** skip GitHub release creation if already exists ([afa13bc](https://github.com/Helmi/argusdev/commit/afa13bc5903b3d062a5c8aa7844d479fc1b62806)) — re-running the publish workflow no longer fails on the GitHub Release step.


### Performance

* **daemon:** reduce per-session output history cap from 10MB to 1MB ([257c39b](https://github.com/Helmi/argusdev/commit/257c39b29b49358ecaf934f210af4ff54986d004)) — large memory headroom for long-running sessions; visible scrollback unaffected for normal use.

## [0.7.1](https://github.com/Helmi/argusdev/compare/v0.7.0...v0.7.1) (2026-04-08)


### Features

* **webui:** drag-and-drop project reordering in sidebar ([4d4459c](https://github.com/Helmi/argusdev/commit/4d4459c3ebc3f536b71a4619aeafa6be8e76f916)) — toggle reorder mode to manually arrange projects; order persists across sessions
* **webui:** connection and auth-expired warning banner ([3b8f602](https://github.com/Helmi/argusdev/commit/3b8f60277ddefd42d0331b6f8aceffbd0069a737)) — amber banner with actionable hints when backend disconnects or auth expires
* per-project td status ([f27a817](https://github.com/Helmi/argusdev/commit/f27a8170f39ffa94924ce6bf1540993fad32bb36)) — task board and td menu items only appear for projects with td initialized
* environment variables editor in agent profiles ([4fff136](https://github.com/Helmi/argusdev/commit/4fff1363822805027c7fd807f95be8b5cc0eeeee))


### Bug Fixes

* **webui:** changelog view freeze with many uncommitted files ([89f5dca](https://github.com/Helmi/argusdev/commit/89f5dca6bcbd944c601b78f8a507e4661ddde92e)) — server-side truncation (default 200 files) with accurate summary stats, search filter, and git status `-uno` optimization
* **webui:** env vars editor loses focus on every keystroke ([77158af](https://github.com/Helmi/argusdev/commit/77158afd1003c3d3507baf6b2d2fc2b59bc1db34))
* **webui:** inconsistent panel header heights ([75f9642](https://github.com/Helmi/argusdev/commit/75f9642dd7a3888c3988a2014886de285a729dc1)) — unified sub-panel headers to h-8
* **webui:** stale fetch errors in changed files view ([75f9642](https://github.com/Helmi/argusdev/commit/75f9642dd7a3888c3988a2014886de285a729dc1)) — AbortController cancels in-flight requests; transient errors no longer wipe the file list
* dev server restarts on frontend edits ([70e45de](https://github.com/Helmi/argusdev/commit/70e45dee04e266ba64b1056d121d408cc4afe21a)) — `tsx watch` now ignores `client/`
* test suite opens browser tabs ([70e45de](https://github.com/Helmi/argusdev/commit/70e45dee04e266ba64b1056d121d408cc4afe21a)) — `openBrowser` skips in VITEST/CI
* hook endpoint 404 on daemon restart ([f27a817](https://github.com/Helmi/argusdev/commit/f27a8170f39ffa94924ce6bf1540993fad32bb36)) — returns 200 for unknown sessions instead of 404
* td detection treats `.td-root` as initialized even before first ticket ([f27a817](https://github.com/Helmi/argusdev/commit/f27a8170f39ffa94924ce6bf1540993fad32bb36))


## [0.7.0](https://github.com/Helmi/argusdev/compare/v0.6.0...v0.7.0) (2026-04-07)


### Features

* hook-based state detection for Claude Code sessions ([613f710](https://github.com/Helmi/argusdev/commit/613f710ec8fea5f099091dd1a655ff5f229f7a2e))
* agent config editor drag-and-drop reorder and UX improvements ([c8e621d](https://github.com/Helmi/argusdev/commit/c8e621dc68e08a23ed50a10c5076f3498bb0cfc7))
* **webui:** add 👀 logo icon next to ArgusDev text in header ([7ceaeaa](https://github.com/Helmi/argusdev/commit/7ceaeaa))


### Bug Fixes

* hook detection: add UserPromptSubmit for busy, use native http hook type, temp file settings ([1f441e8](https://github.com/Helmi/argusdev/commit/1f441e8))
* use pill-shaped 👀 favicon ([ec451f4](https://github.com/Helmi/argusdev/commit/ec451f4))


### Highlights

**Hook-based state detection** replaces fragile terminal buffer scraping for Claude Code sessions.
Instead of polling the xterm.js buffer for text patterns, Claude Code's own lifecycle hooks now
POST state transitions directly to ArgusDev's API:

- `UserPromptSubmit` → busy (user sent a message)
- `PreToolUse` → busy (tool execution)
- `Notification(permission_prompt)` → waiting_input
- `Notification(idle_prompt)` → idle
- `Stop` → idle (response complete)

State updates are immediate — no 100ms polling or 500ms persistence delay.
Non-Claude agents keep buffer-based detection as fallback.

## [0.6.0](https://github.com/Helmi/argusdev/compare/v0.4.2...v0.6.0) (2026-03-30)


### Features

* add SDK session backend infrastructure ([a7bf43a](https://github.com/Helmi/argusdev/commit/a7bf43a14e8d9b9a0e1e1e3fc200c31df1435737))
* add startup script cleanup coverage ([dc8df60](https://github.com/Helmi/argusdev/commit/dc8df608b013ff314423f1c5bd864d0c85567182))
* add TD task card modal and session duration ([b11a9e1](https://github.com/Helmi/argusdev/commit/b11a9e146db1f30fe98e214eef2443c4f7f523eb))
* auto-refresh worktrees and projects on filesystem changes ([2033b26](https://github.com/Helmi/argusdev/commit/2033b26e80902f004938c04aa35ba8eb1b28443b))
* auto-select Fix Rejected Work prompt for rejected tasks ([6df7ad1](https://github.com/Helmi/argusdev/commit/6df7ad10c253230812844aef1b94487c274d74e9))
* **cli:** clean daemon output, add version check, fix port binding ([b16e41c](https://github.com/Helmi/argusdev/commit/b16e41ca1fc863803c03a22b14e1906cf47a4cd5))
* drop legacy Ink-based TUI ([b6a9519](https://github.com/Helmi/argusdev/commit/b6a9519fc3f1bea6dbfacdd3ed1d3f53c19def74))
* expand td prompt template variables ([e65a515](https://github.com/Helmi/argusdev/commit/e65a5155c8b022bf290edb44baeee38157b9c1f1))
* onboarding polish — fix branding, auto-open browser on start ([abbe6da](https://github.com/Helmi/argusdev/commit/abbe6da64b744c2c16f1677fe3b0f984d34d5138))
* register Claude SDK agent and wire end-to-end ([a8be1ff](https://github.com/Helmi/argusdev/commit/a8be1ff8f043b948d34e983a3f35dbef90f57c47))
* rename CACD to ArgusDev ([9cfb23f](https://github.com/Helmi/argusdev/commit/9cfb23f6bd5a4e564563948b1e8388357e2078de))
* **td:** auto-refresh board on issues.db changes ([0de661f](https://github.com/Helmi/argusdev/commit/0de661f492fb894893e517e69c4be68268e2c19a))
* **td:** hide child tasks with open epic parents from board ([289045e](https://github.com/Helmi/argusdev/commit/289045efa53919cd5b2fa2538a4add33b3f29b23))
* **ui:** board UX priority sorting, epic cards, deferred filtering ([#21](https://github.com/Helmi/argusdev/issues/21)) ([80d4ef8](https://github.com/Helmi/argusdev/commit/80d4ef80d3951ae0936e4977c0d13adad6a6abcd))
* **webui:** add SDK session UI components ([58eb05f](https://github.com/Helmi/argusdev/commit/58eb05f47fff087231256ca2985c9c3f334a314d))
* **webui:** close TD review loop from session sidebar ([c2c6f4f](https://github.com/Helmi/argusdev/commit/c2c6f4fe613fd2572afebba7e251db60b4ffd896))
* **webui:** epic detail modal shows child task statuses with Fix action on rejected tasks ([a970fb3](https://github.com/Helmi/argusdev/commit/a970fb3a983d02df30180ec45bd98663901b38d1))
* **webui:** epic detail modal shows child task statuses with Fix/Start action on rejected tasks ([e5d1d7d](https://github.com/Helmi/argusdev/commit/e5d1d7d7ee2a69e009b601dc71a5a08f9c4c2bad))
* **webui:** epic detail modal shows child task statuses with Fix/Start actions ([7cc27bb](https://github.com/Helmi/argusdev/commit/7cc27bb4db43f892d4b2c84f852f192b522f236f))
* **webui:** pre-launch polish batch ([dba9045](https://github.com/Helmi/argusdev/commit/dba90458e7f5715fdf4f91ccd63e6722f925fbf9))


### Bug Fixes

* address rejection feedback - intent check and fallback logic ([6d6b7cf](https://github.com/Helmi/argusdev/commit/6d6b7cfc3e6c34dca96aa22827fde19657676917))
* address reviewer feedback for file watchers ([0c4bac6](https://github.com/Helmi/argusdev/commit/0c4bac6b16c2c5861423efdd3fbd2a126f224e24))
* ApiClientError cause property for pre-ES2022 target ([cc067c9](https://github.com/Helmi/argusdev/commit/cc067c98c29647fc56ffdb9984c505f24043ce5a))
* avoid duplicate TD startup prompt injection ([2b4c189](https://github.com/Helmi/argusdev/commit/2b4c189628f1c673b55eab06bfdcd0bef9717e97))
* **dev:** silence state detection log spam, add socket auth token ([52a83ef](https://github.com/Helmi/argusdev/commit/52a83ef4a69dd2ce3767bf54720cbc22859efc65))
* improve pi state detection patterns ([5731d85](https://github.com/Helmi/argusdev/commit/5731d85a41bbe12526fb6538f699f6aeaac74037))
* pass worktree path to agents requiring positional cwd ([d4149c1](https://github.com/Helmi/argusdev/commit/d4149c185cdb0eceac96d95e7fa37322f56821c0))
* preserve implementer td session identity across fix rounds ([f51a4f3](https://github.com/Helmi/argusdev/commit/f51a4f307febe3daa725bad957fda8821b2ac89e))
* **sdk:** per-turn subprocess spawning, remove input-format flag ([7ac0194](https://github.com/Helmi/argusdev/commit/7ac0194f61d80ef029d029b4d581217215145e6f))
* **sdk:** transform raw events to frontend format for Socket.IO ([0818dcd](https://github.com/Helmi/argusdev/commit/0818dcdb022c8cc0351bd9939ebbffa3673b330a))
* **sessions:** prevent double prompt injection for Codex and CLI-arg agents ([2ec44ce](https://github.com/Helmi/argusdev/commit/2ec44ce5faed6f020dded04a72018883bfb6f134))
* **startup:** lazy-load configurationManager in versionCheckService ([8e20580](https://github.com/Helmi/argusdev/commit/8e205808ffabe5f5699609ed3205026d2857abf3))
* **state:** Claude Code detection — remove over-aggressive ctrl+r guard, expand idle patterns ([a4d557e](https://github.com/Helmi/argusdev/commit/a4d557ed87d3a76a819e52c5cc22a7b2993f59f0))
* **td:** harden task detail payload and timestamp handling ([#20](https://github.com/Helmi/argusdev/issues/20)) ([6758faa](https://github.com/Helmi/argusdev/commit/6758faa3c06c6ec3a25b9d8315618e8dd08abb9a))
* tighten Pi busy detection around spinner output ([ea58b7e](https://github.com/Helmi/argusdev/commit/ea58b7e68de0f9ab3987df75f541470575e6e563))
* **ts:** change startupPromptToInject type from null to undefined ([598d12a](https://github.com/Helmi/argusdev/commit/598d12ac623af051f362a721e1ba77eb10c47759))
* **ui:** board column collapse, font sizes, contrast ([32ea110](https://github.com/Helmi/argusdev/commit/32ea1106586baf439095692063cb2b186181f664))
* vitest config exclusions and 13 pre-existing test failures ([b5a19cc](https://github.com/Helmi/argusdev/commit/b5a19cc2c9a5d195e189de197d48e4ddcfd0e9e8))
* **webui:** auto-infer review/fix worktree from task branch ([fd578b8](https://github.com/Helmi/argusdev/commit/fd578b8d091fbb0601eb3747bd11871eb09fedb0))
* **webui:** break infinite fetch loop caused by socket useEffect deps ([fcb462a](https://github.com/Helmi/argusdev/commit/fcb462ad13350f1b2c2c3b75449cb3167c1b96cd))
* **webui:** don't auto-select worktree for fix/review sessions with no match ([533b944](https://github.com/Helmi/argusdev/commit/533b94427414e2267792c06bd8879db2ffc044b2))
* **webui:** don't disconnect socket in useEffect cleanup ([c3cf172](https://github.com/Helmi/argusdev/commit/c3cf172cd60ab227b055b922d4fd7cc86be018fd))
* **webui:** force websocket transport in dev, fix proxy target ([a5d6118](https://github.com/Helmi/argusdev/commit/a5d61186ec0e51a54ca16a65404dd3bde00b670c))
* **webui:** never resolve project root as task worktree in tdWorktreeResolver ([cef3927](https://github.com/Helmi/argusdev/commit/cef3927ef94ffe18155b21c988a4d358ea1b4c04))
* **webui:** prevent scroll jump when terminal regains focus ([c0f18a0](https://github.com/Helmi/argusdev/commit/c0f18a08c3d6eaa8b4e28f17a4b95a381de65317))
* **webui:** re-subscribe terminal sessions on socket reconnect ([143dc00](https://github.com/Helmi/argusdev/commit/143dc00735da8d67b0818b18b22f64e5191ded07))
* **webui:** redirect to passcode screen on 401 auth failure ([0a8978e](https://github.com/Helmi/argusdev/commit/0a8978eec3b250846a0f5a9e7fb067a0d44ce0d5))
* **webui:** restore dev socket connect state after login ([de9e81a](https://github.com/Helmi/argusdev/commit/de9e81ab54346aafbd5edca758bbdde75f61d90a))
* **webui:** scope worktree inference to fix/review intents only ([cdf1370](https://github.com/Helmi/argusdev/commit/cdf137087b6a938af581add85a181fbbaae72adc))
* **webui:** task board always fetches on open, not gated on tdStatus ([eef7f11](https://github.com/Helmi/argusdev/commit/eef7f11ffcc13dfa8ee13a420e98327869df9ad5))
* **webui:** use x-access-token header for API auth in dev mode ([4abc07c](https://github.com/Helmi/argusdev/commit/4abc07ce6fefa14c97b359560aac616be79e320f))
* **webui:** wire fix intent through API for rejected subtask sessions ([5426af7](https://github.com/Helmi/argusdev/commit/5426af77d9d6cfb920707c3e82c734323f674533))
* **webui:** worktree selection defaults — intent-scoped mode, auto-select in existing ([8e0acfc](https://github.com/Helmi/argusdev/commit/8e0acfccdf5ccb080f37d82a6ca417eac56eb068))

### [0.4.2](https://github.com/Helmi/cacd/compare/v0.4.1...v0.4.2) (2026-03-01)


### Features

* **ui:** simplify session detail sidebar — remove redundant status badge, agent label, and location header; keep branch + path with copy ([#19](https://github.com/Helmi/cacd/issues/19)) ([d7a6ba0](https://github.com/Helmi/cacd/commit/d7a6ba0210db2c608bc3067b94b36138d7f4dacc))


### Bug Fixes

* **ci:** fix npm publish workflow failing when version already bumped ([c7259fa](https://github.com/Helmi/cacd/commit/c7259fa0e49722826b2e92093b3fb6392bd16429))

### [0.4.1](https://github.com/Helmi/cacd/compare/v0.4.0...v0.4.1) (2026-03-01)


### Bug Fixes

* **sessions:** fix rehydrated sessions returning 404 on stop, restart, rename, and other operations after daemon restart — session lookups now search across all project managers ([bf8392b](https://github.com/Helmi/cacd/commit/bf8392bd39e5b8e6221883eebbba8d76f7a259bb))
* **sessions:** deduplicate sessions in the aggregated session list to prevent the same session appearing twice across managers
* **sessions:** fix Socket.IO subscribe, input, and resize handlers only finding sessions in the current project manager
* **ci:** resolve Windows CI failures in tests and fix bun lockfile instability ([dca40a1](https://github.com/Helmi/cacd/commit/dca40a140407b1e0c710f2d97b5cfe8823ecc931), [fcfd69b](https://github.com/Helmi/cacd/commit/fcfd69b5611f5e7b14e360d3ddf0ca6e85e9b8dd), [6815924](https://github.com/Helmi/cacd/commit/6815924b4f7f7f439c94d70cc0f741650c3e3e45))
