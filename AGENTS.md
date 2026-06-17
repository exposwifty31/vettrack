# AGENTS.md

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
