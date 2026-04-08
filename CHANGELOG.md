# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
