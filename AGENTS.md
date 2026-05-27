# AGENTS.md

## Cursor Cloud specific instructions

### Cloud agent starter skill
Use `docs/cloud-agent-starter-skill.md` as the default quickstart runbook for environment setup, auth/login modes, and test workflows by code area.

### Cursor project rules (IDE agents)
Persistent guidance for Cursor (and compatible agents) lives under `.cursor/rules/*.mdc`. The umbrella rule **`engineering-and-agent-principles.mdc`** is always applied and stacks with focused rules such as `typescript-standards.mdc`, `express-server.mdc`, and `vettrack-stabilization-plan.mdc`. For rationale, impact, and how to maintain these rules over time, see `docs/engineering-rules-rollout.md`.

**Codex PR reviews:** Address every **chatgpt-codex-connector** inline comment before merge — fix in code, push, and reply on the thread. See `.cursor/rules/codex-review-comments.mdc`.

### Architecture
VetTrack is a single full-stack app: React 18 + Vite frontend (port 5000) and Express + TypeScript backend (port 3001), backed by PostgreSQL. **Canonical architecture references:** `README.md` (overview, frozen architecture topics) and `CLAUDE.md` (engineering rules, post-Phase-9 doctrine). `CONTEXT.md` holds the clinical glossary. `replit.md` is a historical snapshot.

### Prerequisites
- **Node.js >=22.12.0** (`.nvmrc` specifies 22.14.0)
- **pnpm 9.15.9** (declared in `package.json` `packageManager` field)
- **PostgreSQL 16** running locally

### Database Setup
1. Start PostgreSQL: `sudo pg_ctlcluster 16 main start`
2. Create user/database if not already present:
   ```
   sudo -u postgres psql -c "CREATE USER vettrack WITH PASSWORD 'vettrack';"
   sudo -u postgres psql -c "CREATE DATABASE vettrack OWNER vettrack;"
   ```
3. Run migrations (no dotenv — pass env vars explicitly):
   ```
   DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack npx tsx -e "
   const { runMigrations } = require('./server/migrate.ts');
   runMigrations().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
   "
   ```

### Environment Variables
The app loads env vars from `.env.local` and `.env` at startup via `server/lib/env-bootstrap.ts` (dotenv). Vite also reads `.env` automatically for `VITE_*` vars. Copy `.env.example` to `.env` and fill in the required values.

A minimal `.env` for dev:
```
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack
SESSION_SECRET=dev-session-secret-for-local-development
NODE_ENV=development
```

The `dev` script sets `PORT=3001` automatically via `cross-env`; you do not need to set it in `.env`.

### Running the Dev Server
```bash
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack PORT=3001 pnpm dev
```
This starts both the Express API (port 3001) and Vite dev server (port 5000) via `concurrently`.

### Frontend Auth Caveat
The frontend always wraps the app in `<ClerkProvider>`. Without `VITE_CLERK_PUBLISHABLE_KEY`, the Clerk SDK may error in the browser. The **backend** has a dev-mode bypass (hardcoded admin user when no `CLERK_SECRET_KEY` is set), so API routes work without Clerk keys.

The repo's Clerk keys are **production keys** (`pk_live_*` / `sk_live_*`) bound to `clerk.vettrack.uk`. These reject requests from `http://localhost` origins. To use them locally, set up an HTTPS proxy:
1. Add `127.0.0.1 vettrack.uk` to `/etc/hosts`
2. Generate a self-signed cert: `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /tmp/certs/vettrack.key -out /tmp/certs/vettrack.crt -subj "/CN=vettrack.uk" -addext "subjectAltName=DNS:vettrack.uk"`
3. Run a Node HTTPS proxy on port 443 forwarding to Vite on port 5000
4. Open Chrome with `--ignore-certificate-errors` flag, navigate to `https://vettrack.uk`

The Clerk instance supports **password**, **email OTP** (6-digit code), **email link**, and **Google OAuth**. However, the production Clerk instance has **client trust / bot protection** enabled (`needs_client_trust` status), which blocks automated/programmatic sign-in — including Puppeteer, `page.evaluate`, and direct Clerk JS SDK calls. To complete the full authenticated UI flow, **a human must sign in interactively via the Desktop pane**. A dedicated test account exists in the Clerk dashboard (credentials stored in your password manager, not in this file).

All API route modules are registered via `server/app/routes.ts` (~49 routers under `/api/*`). Background workers and schedulers are wired in `server/app/start-schedulers.ts`. The single source of truth for what is registered is those two files — do not rely on older summaries.

### Commands
| Action | Command |
|--------|---------|
| Install deps | `pnpm install` |
| Dev server | `DATABASE_URL=... PORT=3001 pnpm dev` |
| Type check | `npx tsc --noEmit` |
| Tests | `pnpm test` (runs 5 test suites: basic, concurrency, offline, conflict, pwa.system) |
| Build | `pnpm build` |
| E2E tests | `pnpm test:signup` (requires Playwright + Chromium) |

### Gotchas
- The `predev` script runs `kill-port 3001 5000` to clear stale processes silently before starting.
- No ESLint config exists in this repo.
- The runtime applies pending migrations on startup via `runMigrations()` in `server/index.ts`. `pnpm db:migrate` runs the same path on demand. After editing `server/db.ts`, generate the next migration with `npx drizzle-kit generate` and commit it.
- The `server/migrate.ts` file only exports `runMigrations()` — it has no self-executing code.
- Realtime, Code Blue, and PWA surfaces are **frozen** post-Phase-9. See `CLAUDE.md` → "Frozen architecture surfaces" and "Operational doctrine" before editing them.
