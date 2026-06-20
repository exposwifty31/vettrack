# AGENTS.md

> Read by OpenAI Codex, GitHub Copilot Workspace, Aider, Cline, Roo Code, and similar tools.
> Mirrors CLAUDE.md — keep both files in sync when you update either.

---

## Start Here

Read these files before writing any code:

1. `CLAUDE.md` — full project context, stack, auth modes, architecture, frozen surfaces
2. `PLAN.md` — what is currently in scope and what is out of scope
3. `TASKS.md` — your specific task and acceptance criteria
4. `docs/CONVENTIONS.md` — naming, patterns, error handling, i18n rules
5. `DEFINITION_OF_DONE.md` — completion checklist
6. Every file you plan to modify

If any of these are missing or incomplete, say so before proceeding.

---

## Operating Rules

### Always do
- Filter every DB query by `clinicId` — multi-tenancy is a non-negotiable invariant
- Follow the patterns documented in `docs/CONVENTIONS.md`
- Search for existing utilities before creating new ones
- Write tests alongside implementation — not after
- State what you changed, what you did not change, and why
- List follow-up items you noticed but did not act on (add to `TASKS.md` Backlog)
- Run `npx tsc --noEmit` and `pnpm test` before declaring a task done

### Never do
- Modify code outside the scope of the current task
- Add dependencies without noting them in your response
- Leave TODO placeholders in delivered code
- Write comments that describe what the code does instead of why
- Use `any` or unsafe type casts without an inline explanation
- Catch errors silently
- Touch realtime, Code Blue, or PWA code without reading the "Frozen architecture surfaces" section in `CLAUDE.md` first
- Add emergency endpoints to any SW cache path
- Rename `vt_appointments`, `/api/appointments`, or `appointmentsPage.*` i18n keys
- Commit or push to `main` directly
- Run database migrations without explicit human instruction

### Stop and ask when
- The task requires an unexpected schema or database change
- A security-sensitive file is in scope (auth, payments, PII)
- You are uncertain which of two existing patterns to follow
- Tests fail and you do not understand why after one attempt
- The task as written requires changing significantly more code than described

---

## Output Format

After every task:

```
## Changes
- `path/to/file.ext` — [one sentence describing the change]
- `path/to/test.ext` — [test added/modified]

## Verification
Run: [exact commands to verify]

## Deviations from plan
[None, or: what changed and why]

## Follow-up items (not acted on)
- [item — added to TASKS.md Backlog]
```

---

## Commit Message Format

```
type(scope): short description in imperative mood

- Why this change was needed
- What approach was taken and why
- Refs TASK-NNN if applicable

Types: feat | fix | refactor | test | docs | chore | perf
```

---

## Decision Priority

When conventions conflict:

1. Security
2. Multi-tenancy invariant (clinicId filter)
3. Existing codebase conventions
4. Correctness
5. Performance
6. Elegance

---

## Cursor Cloud specific instructions

### Cloud agent starter skill
Use `docs/cloud-agent-starter-skill.md` as the default quickstart runbook for environment setup, auth/login modes, and test workflows by code area.

### Cursor project rules (IDE agents)
Persistent guidance for Cursor lives under `.cursor/rules/*.mdc` and root `.cursorrules`. See `docs/engineering-rules-rollout.md`.

**Codex PR reviews:** Address every **chatgpt-codex-connector** inline comment before merge.

### Architecture
VetTrack is a single full-stack app: React 18 + Vite frontend (port 5000) and Express + TypeScript backend (port 3001), backed by PostgreSQL. **Canonical references:** `README.md`, `CLAUDE.md`, `CONTEXT.md`, [`docs/README.md`](docs/README.md). **Scope change (June 2026):** [`docs/scope-change-2026.md`](docs/scope-change-2026.md). **Maintenance scope:** [`docs/MAINTENANCE_MODE.md`](docs/MAINTENANCE_MODE.md) — Capacitor + monolith here; Expo/RN in [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop).

### Prerequisites
- **Node.js >=22.12.0** (`.nvmrc` specifies 22.14.0)
- **pnpm 9.15.9**
- **PostgreSQL 16** running locally

### Database Setup
1. Start PostgreSQL: `sudo pg_ctlcluster 16 main start`
2. Create user/database if not already present:
   ```
   sudo -u postgres psql -c "CREATE USER vettrack WITH PASSWORD 'vettrack';"
   sudo -u postgres psql -c "CREATE DATABASE vettrack OWNER vettrack;"
   ```
3. Run migrations: `pnpm db:migrate` (or pass `DATABASE_URL` explicitly)

### Environment Variables
Loaded from `.env.local` and `.env` via `server/lib/env-bootstrap.ts`. Minimal dev:

```
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack
SESSION_SECRET=dev-session-secret-for-local-development
NODE_ENV=development
```

### Running the Dev Server
```bash
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack PORT=3001 pnpm dev
```

### Frontend Auth Caveat
Without `VITE_CLERK_PUBLISHABLE_KEY`, Clerk SDK may error in the browser. Backend dev-bypass works without `CLERK_SECRET_KEY`. Production Clerk keys require HTTPS proxy for localhost — see existing vettrack.uk proxy notes in this file's git history or `docs/dev-signin-runbook.md`.

**~44** API route modules register via `server/app/routes.ts`; schedulers via `server/app/start-schedulers.ts` + `server/jobs/runtime.ts`.

### Commands
| Action | Command |
|--------|---------|
| Install deps | `pnpm install` |
| Dev server | `DATABASE_URL=... PORT=3001 pnpm dev` |
| Type check | `npx tsc --noEmit` |
| Tests | `pnpm test` (full Vitest suite) |
| Doc inventories | `pnpm docs:audit` |
| Build | `pnpm build` |
| Native app (Capacitor) | `pnpm cap:build:native` / `pnpm cap:install:ios-sim` — see `docs/mobile/README.md` |
| E2E tests | `pnpm test:signup` (Playwright + Chromium) |

### Railway CLI and MCP
See `docs/cloud-agent-starter-skill.md` §5. MCP config: `.cursor/mcp.json` — never commit tokens.

### Gotchas
- `predev` kills ports 3001 and 5000 before start.
- Schema tables live in `server/schema/*.ts` (re-exported from `server/db.ts`). After edits: `npx drizzle-kit generate` → commit SQL → `pnpm db:migrate`.
- Migrations also run at startup via `runMigrations()` in `server/index.ts`.
- Realtime, Code Blue, and PWA surfaces are **frozen** — see `CLAUDE.md`.
