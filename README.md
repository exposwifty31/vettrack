# VetTrack

Veterinary hospital operations platform — equipment tracking, waitlist, tasks, Code Blue, inventory, scheduling, and external PMS integrations for multi-clinic deployments.

**Stack:** React 18 + Vite + TypeScript · Express + Node.js · PostgreSQL + Drizzle ORM · BullMQ + Redis · Clerk auth · PWA/offline-first · Capacitor native shell · Railway deployment

---

## Quick Start (Local Development)

### Prerequisites
- Node.js >= 22.12.0 (`nvm use` to match `.nvmrc`)
- pnpm 9.15.9
- PostgreSQL (local or hosted)
- Redis (optional — required for BullMQ job runtime, push notifications, integration workers)

### Setup

```bash
pnpm install
cp .env.example .env        # fill in DATABASE_URL, CLERK keys, etc.
pnpm db:migrate             # run all migrations
pnpm dev                    # starts API on :3001 + frontend on :5000
```

See [`docs/setup/environment.md`](docs/setup/environment.md) and [`docs/dev-signin-runbook.md`](docs/dev-signin-runbook.md) for auth setup.

### Available Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start API (:3001) + frontend (:5000) concurrently |
| `pnpm build` | Build frontend for production |
| `pnpm start` | Start production server |
| `pnpm worker` | Start notification worker CLI (requires Redis) |
| `pnpm test` | Run full Vitest suite |
| `pnpm typecheck` | Type-check frontend + server (both tsconfigs) |
| `pnpm db:migrate` | Run pending database migrations |
| `pnpm validate:prod` | Pre-deployment validation checks |
| `pnpm auth:preflight` | Verify Clerk auth configuration |
| `pnpm docs:audit` | Regenerate `docs/audit/*` route and schema inventories |
| `pnpm i18n:check` | Verify Hebrew/English locale parity |
| `pnpm i18n:generate-types` | Regenerate `src/lib/i18n.generated.d.ts` |
| `pnpm tenant:lint` | Lint DB queries for missing `clinicId` filters |
| `pnpm architecture:gates` | Run all architecture gate scripts |
| `pnpm knip` | Find unused exports and dead code |
| `pnpm cap:build:native` | Build bundled Capacitor iOS shell |
| `pnpm cap:build:native:android` | Build bundled Capacitor Android shell |
| `pnpm cap:install:ios-sim` | Build + install on iOS Simulator (iPad A16 by default) |
| `pnpm cap:open:ios` | Open the Xcode workspace |
| `pnpm deck:seed` | Seed investor-deck demo data (local Postgres) |

---

## Architecture

```
vettrack/
├── src/              React frontend (PWA, offline-first, RTL-capable)
│   ├── app/          SPA routing (lazy-loaded pages via wouter)
│   ├── pages/        Route-level page components
│   ├── features/     Feature-scoped modules
│   ├── components/   Shared UI components (shadcn primitives in components/ui/)
│   ├── native/       Capacitor native shell (NativeShell, NativeTabBar, ScanFab)
│   ├── desktop/      WebShell delegation (PageShell) + marketing/ shell
│   ├── shell/        Shell orchestration — WebShell, desktop/, mobile/ sub-shells
│   ├── shared/       Platform target helpers (PlatformRouter, resolvePlatformTarget)
│   └── hooks/        Auth, push, settings, offline sync
├── server/           Express API + business logic
│   ├── app/routes.ts Route registration (~44 modules)
│   ├── routes/       One file per API resource
│   ├── schema/       Drizzle tables (re-exported via db.ts)
│   ├── services/     Domain services (equipment, dispense, waitlist, …)
│   ├── jobs/         BullMQ job runtime (charge-alert, expiry, …)
│   ├── workers/      Worker implementations + in-process schedulers
│   └── integrations/ External PMS adapters
├── migrations/       SQL migrations (applied at startup + pnpm db:migrate)
├── scripts/          Dev/ops and architecture gate scripts
└── locales/          en.json, he.json (Hebrew default)
```

**Scope note:** ER, patients, medication formulary, and pharmacy forecast were removed in migrations 142–143. See [`docs/scope-change-2026.md`](docs/scope-change-2026.md).

### Key Architecture Rules

1. **Every DB row is clinic-scoped** — every query must filter by `clinicId`. No exceptions.
2. **Schema** — tables live in `server/schema/*.ts`; edit there then `npx drizzle-kit generate` → commit SQL → `pnpm db:migrate`.
3. **Auth modes** — without Clerk keys, dev bypass uses a hardcoded admin user. Production requires `CLERK_SECRET_KEY` + `VITE_CLERK_PUBLISHABLE_KEY`.
4. **Role from DB** — `req.authUser.role` comes from `vt_users.role`, never JWT claims.
5. **Background jobs** — `startJobRuntime()` in `server/jobs/runtime.ts` plus schedulers in `server/app/start-schedulers.ts`. Redis required in production.
6. **Credentials at rest** — integration secrets in `vt_server_config` encrypted with AES-256-GCM when `DB_CONFIG_ENCRYPTION_KEY` is set.
7. **Platform split** — `src/shared` exposes `resolvePlatformTarget()` / `usePlatformTarget()` returning `"native" | "web"`. `PlatformRouter` is the single branch point: native → `NativeShell` (safe-area chrome, tab bar, scan FAB); web → `WebShell` (desktop `PageShell`; marketing pages under `src/desktop/marketing/`). Use the shared helpers for any new platform-conditional code; do not call `isCapacitorNative()` from `@/lib/capacitor-runtime` in new code.

### Database (prefix `vt_`)

See generated inventory: [`docs/audit/db.md`](docs/audit/db.md). Core domains: clinics/users, equipment + waitlist + operational state, Code Blue, inventory/containers/dispense, appointments (tasks), shifts, integrations, event outbox, audit.

> User-facing copy uses **Tasks / משימות**. The `vt_appointments` table, `/api/appointments`, and `appointmentsPage.*` i18n keys are intentionally **not renamed** — only rendered copy changed.

---

## Realtime, Code Blue, and PWA architecture

These surfaces are **frozen** — extend them, do not replace them. Full detail in [`CLAUDE.md`](CLAUDE.md) and [`docs/architecture/offline-realtime-invariants.md`](docs/architecture/offline-realtime-invariants.md).

- **SSE** via `/api/realtime/stream` + outbox-backed ordering (`vt_event_outbox`)
- **Code Blue** mutations require online execution; never queue offline
- **PWA** build-tag cache versioning; emergency endpoints never cached in SW
- **Authority evaluators** `off | shadow | enforce` per clinic; Strategy A safety net for legacy shift authority

---

## iOS Simulator

> **macOS + Xcode required.** The simulator workflow is not available on Linux/CI.

### Quick start

```bash
# Build bundled web assets + sync + install on iPad A16 simulator (default)
pnpm cap:install:ios-sim

# Install on iPhone 16 Pro simulator instead
./scripts/install-ios-sim.sh --iphone

# Reuse the last build (skip rebuild + sync)
./scripts/install-ios-sim.sh --skip-build

# Target a specific simulator by UDID
./scripts/install-ios-sim.sh --udid <UDID>

# Build web assets and sync to iOS only (without installing on simulator)
vite build && npx cap sync ios
```

`xcrun simctl list devices available` lists available simulators and their UDIDs. The default UDID (`DA8D1142-E500-43D7-84C8-8678BD1B3542`) targets iPad (A16) to match the ship-checklist device matrix.

### Required `.env` keys for a Clerk-enabled native build

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_live_…   # must be pk_live_, not pk_test_
VITE_API_ORIGIN=https://vettrack.uk
```

> Use `.env`, **not** `.env.local` — the native shell script reads `.env` only so the dev-bypass path in `.env.local` does not accidentally produce a dev-auth native build.

### What the script does

1. Runs `scripts/build-native-shell.sh --ios` (`vite build` → `npx cap sync ios`) unless `--skip-build` is passed
2. Boots the target simulator
3. Builds the Xcode scheme (`App`) in Debug for the simulator destination
4. Installs the `.app` bundle via `xcrun simctl install`
5. Launches the app and opens the Simulator app

For Xcode GUI access run `pnpm cap:open:ios` after the sync step.

Full native build and ship docs: [`docs/capacitor-native-app.md`](docs/capacitor-native-app.md) · [`docs/mobile/README.md`](docs/mobile/README.md)

---

## Deployment

Deployed via [Railway](https://railway.app). See [`docs/devops/ci-cd.md`](docs/devops/ci-cd.md).

**Required production env vars:** `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `ALLOWED_ORIGIN`, `CLERK_WEBHOOK_SECRET`, `DB_CONFIG_ENCRYPTION_KEY`

Full reference: `.env.example`

---

## Docs

- [**Documentation index**](docs/README.md)
- [Scope change 2026](docs/scope-change-2026.md)
- [Mobile native](docs/mobile/README.md)
- [Migration workflow](docs/migrations.md)
- [Testing guide](docs/testing-guide.md)
- [Integrations guide](docs/integrations-guide.md)
