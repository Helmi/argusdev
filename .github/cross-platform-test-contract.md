# Cross-Platform Test Contract

This contract defines how contributors write tests that are stable across Linux, macOS, and Windows.

## Scope

Applies to tests that touch:
- filesystem paths
- shell/command execution
- environment variables
- Unicode text/filenames

## Contract

1. Paths
- Build paths with `path.join()`/`path.resolve()`, never hardcoded separators.
- Avoid asserting full absolute paths; assert normalized segments or basenames.
- When comparing path strings, normalize first (for example, convert `\\` to `/` in test assertions).

2. Shell and command execution
- Prefer argument arrays over shell-quoted command strings.
- Do not assert platform-specific quoting (`'` vs `"`), escaping, or executable suffixes (`.cmd`).
- If behavior is intentionally shell-specific, gate assertions by platform and document why.

3. Environment variables
- Tests must set required env vars explicitly and restore process env after each test.
- Treat env keys as case-insensitive on Windows (`PATH`/`Path`) and case-sensitive elsewhere.
- Do not rely on machine-local env values (homebrew paths, personal config, local shell rc files).

4. Unicode and encoding
- Use UTF-8 fixtures/content.
- Add at least one non-ASCII sample (for example, `cafe-\u00E9`, `nihongo-\u65E5\u672C\u8A9E`) when touching text/path handling.
- Avoid locale-dependent ordering assertions unless locale is explicitly fixed in the test.

## CI Gate Mapping

Changes affecting this contract must pass these CI checks from `.github/workflows/ci.yml`:
- `CI / Verify (Ubuntu, Node 26)`
- `CI / Test (ubuntu-latest, Node 26.x)`
- `CI / Test (macos-latest, Node 26.x)`
- `CI / Test (windows-latest, Node 26.x)`
