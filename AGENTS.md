# ArgusDev

A local development orchestrator for AI coding agent sessions. Runs as a **daemon** exposing a **Fastify API + Socket.IO** server and a **React WebUI**. Manages PTY sessions for coding agents (Codex, Claude Code, Pi, etc.), git worktrees, and optional task integration via `td`.

**Repo:** [github.com/Helmi/argusdev](https://github.com/Helmi/argusdev) (private)

## Task Management

When instructed in context with the 'td' task  management or with tasks starting with 'td-...' make sure to be aware of how td works and use the td-cli-helper skill to progress tasks accordingly.

## Safety Guardrails

- **CRITICAL:** Never run `bun run build` or `bun run install:global` without explicit user confirmation. The global install is used productively. Make use of the dev-server to confirm changes.
- **NEVER** execute release commands autonomously. See the `argusdev-release` skill for the release workflow.
- **NEVER** push to `main` without a passing build.

## Project Structure

- `src/` — Backend: daemon, API server, session management, PTY handling
  - `services/` — Core domain logic (SessionManager, CoreService, APIServer, ProjectManager)
  - `cli/` — CLI commands (thin API client, no business logic)
  - `utils/` — Shared utilities, hook executor
- `client/` — React + Vite WebUI (Tailwind + Lucide)
- `dist/` — Compiled backend (`cli.js`)
- `scripts/` — Build and release tooling
- `.agents/skills/` — Agent skills (cross-agent, symlinked to `.claude/skills/` etc.)

## Build, Test & Dev

**Package manager:** `bun` only. Use `bun run <script>` (not bare `bun test` — that invokes Bun's runner instead of Vitest).

```bash
bun install                    # Install deps
bun run build                  # Build backend (tsc) + frontend (vite)
bun run test                   # Run Vitest suite
bun run test -- src/services/sessionManager.test.ts  # Scoped test run
bun run lint                   # ESLint + Prettier check
bun run dev                    # Hot-reload: backend (headless) + frontend (Vite) concurrently
bun run install:global         # Build + install globally (npm nested strategy)
```

PTY sessions die on backend restart during dev — just restart them.

## Architecture

- **Daemon:** Node.js process owning all PTY sessions. Runs headless by default.
- **API:** Fastify server (configurable port) + Socket.IO for real-time terminal streaming.
- **WebUI:** React SPA served by the daemon. Vite dev server proxies to backend in dev.
- **CLI:** `argusdev` — thin client that talks to the daemon API. No business logic in CLI layer.
- **Core Service:** Singleton (`coreService.ts`) orchestrating state across all interfaces.

## Coding Style

Prettier + ESLint enforced. Beyond that:

```ts
// const over let — use ternaries or early returns
const mode = headless ? 'daemon' : 'server'

// Avoid else — prefer early returns
function resolve(session: Session) {
  if (!session.active) return null
  return session.worktree
}

// Avoid destructuring — dot notation preserves context
session.id        // ✓
const { id } = s  // ✗

// Single-word names where possible
const sessions = manager.list()  // ✓
const sessionList = manager.list()  // ✗

// Inline when used once
const config = await Bun.file(path.join(dir, 'config.json')).json()  // ✓
// not: const configPath = path.join(dir, 'config.json')
//      const config = await Bun.file(configPath).json()
```

- **Error handling:** Effect-ts patterns. No raw try/catch.
- **Logging:** `logger.info()` / `logger.error()` — never `console.log`.
- **Types:** Explicit, avoid `any`. Prefer functional array methods (`map`, `filter`, `flatMap`) over `for` loops.
- **Backend naming:** PascalCase for services/components, camelCase for functions/variables.

## WebUI Design Conventions

### Typography & Density
The UI runs at a density that balances information and readability. Do not go smaller than these baselines:

- **Primary text** (task titles, session names, content): `text-sm` (14px)
- **Secondary text** (labels, badges, counts, IDs): `text-xs` (12px)
- **Do not use** `text-[9px]`, `text-[10px]`, or `text-[11px]` — these are too small to read comfortably

### Contrast
- Never apply opacity modifiers (`/50`, `/60`) to text that is already `text-muted-foreground` — it becomes unreadable
- `text-muted-foreground` is the floor for secondary text; use `text-foreground` for primary content
- Colored accents (priority badges, status dots) should use `text-red-400`, `text-orange-400` etc. — not further dimmed with opacity

### Board / Kanban
- Columns collapse automatically when `issues.length === 0` — derived from data, no `useState` for this
- Never use `min-w-max` on the board container — columns must share the viewport width via flex
- Expanded columns: `flex-1 min-w-[220px] max-w-[480px]`
- Collapsed columns: `w-10 shrink-0` (icon + count only, no manual toggle)

## Conventions

- **Commits:** Conventional Commits — `type: subject` (e.g., `feat: add session restore`, `fix: worktree cleanup on exit`). Note if change affects backend, frontend, or both.
- **Testing:** Vitest unit tests alongside files (`*.test.ts`). Use `vi.mock` for externals (git, fs, child_process). Maintain high coverage on core services.
- **CLI rule:** CLI is a thin API client. Fallback to direct service only on `ECONNREFUSED` (daemon unreachable), never on 404 from a running daemon.
