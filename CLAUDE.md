# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm install
pnpm dev                    # API on :3001 + Vite on :5000 (kills ports first via predev)

# Type checking — run after every file change (two tsconfigs: frontend + server)
pnpm typecheck               # tsc --noEmit (frontend) && tsc -p tsconfig.server.json --noEmit (server)
pnpm typecheck:server         # server tsconfig only

# Tests
pnpm test                   # vitest unit/integration (excludes DB/live-server tests)
pnpm test -- --reporter=verbose  # with detail
pnpm test -- tests/some.test.ts  # single file
pnpm test:db-integration    # equipment-operational-state DB test (needs DATABASE_URL + migrations)
pnpm test:integration:ops   # equipment operational-state + waitlist integration tests
pnpm test:playwright:ci     # Playwright CI suite (Chromium)
pnpm test:playwright:phase9 # Phase 9 realtime/PWA drills (needs running app)
pnpm test:signup            # signup E2E flow

# Architecture gates (server/schema, module boundaries, dead code)
pnpm architecture:gates      # tsc (frontend + tsconfig.server-check.json) + depcruise + madge cycles
pnpm tenant:lint:touched     # warn-only: flags queries missing clinicId filter (touched files); NOT part of architecture:gates
pnpm depcruise:check         # dependency-cruiser boundary check against known-violations baseline
pnpm architecture:cycles     # import-cycle regression check
pnpm knip                   # unused files/exports/deps (also not part of architecture:gates)

# i18n
pnpm i18n:check              # locales/en.json ⟷ locales/he.json parity

# Database
pnpm db:migrate             # apply pending migrations on demand (same path runs at server startup)
npx drizzle-kit generate    # author the next migration after schema changes in server/db.ts
npx drizzle-kit push        # push schema directly (dev only)

# Native shell (Capacitor — ios/ + android/ wrap the built web bundle)
pnpm cap:build:native       # scripts/build-native-shell.sh --ios (use --android / --all via cap:build:native:android / :all)
pnpm cap:open:ios           # open Xcode project
pnpm cap:install:ios-sim    # install onto booted simulator

# Other
pnpm build                  # frontend production build → dist/public
pnpm start                  # production server
pnpm worker                 # background job worker (requires Redis)
pnpm seed:dev               # seed dev database (server/seed.ts)
pnpm auth:preflight         # verify Clerk config + auth mode
pnpm validate:prod          # pre-deployment checks
```

**Native shell builds must go through `scripts/build-native-shell.sh`** (`pnpm cap:build:native`), never plain `pnpm build && npx cap sync`. The script bakes `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_API_ORIGIN` into the bundle (read from `.env` only — it ignores `.env.local`) and never sets `CAPACITOR_SERVER_URL` (a thin web wrapper breaks App Review 4.2 and social OAuth). A plain `pnpm build` has no Clerk key, so the shell silently falls into dev-bypass and crashes on `useUser`/`ClerkProvider`.

**Minimal dev `.env`:**
```
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack
SESSION_SECRET=dev-session-secret-for-local-development
NODE_ENV=development
```
Omit `CLERK_SECRET_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` to use dev-bypass auth (hardcoded admin user, no Clerk SDK required).

**Env precedence:** `.env.local` → `.env` → OS env. Both files loaded by `server/lib/env-bootstrap.ts` at startup.

## Working Conventions

- Act directly — don't narrate what you're about to do before doing it.
- Don't add comments unless the code is genuinely non-obvious.
- Don't refactor code outside what was asked for in the current task.
- Don't uncomment disabled/skipped test blocks unless explicitly instructed to.
- Commit after completing each task (still follow standard git-workflow rules: new commits, no amend/force-push/--no-verify).
- Before reporting a task done, verify claims against real evidence (Read/grep the actual file, run the actual test/command) and record it in docs/audit/PROOF_ALIGNMENT_LOG.md — see that file for the entry format. Don't log summaries of what should be true; log what was actually checked.

## Architecture

VetTrack is a veterinary hospital operations platform: equipment tracking & custody, Code Blue emergency workflows, inventory/dispense, tasks & shifts, and external PMS integrations for multi-clinic deployments. (Legacy `/patients`, `/er`, `/billing`, `/meds` routes survive only as redirects — see scope note below.)

**Stack:** React 18 + Vite frontend (port 5000) · Express + TypeScript backend (port 3001) · PostgreSQL + Drizzle ORM · BullMQ + Redis · Clerk auth · PWA / offline-first · Capacitor 8 native shell (iOS/Android)

**Active program (intent, not yet built):** `docs/design/program-plan.md` is the forward-looking program — per-role UX, the web app as a management console, and the Command Center board as a fourth `"board"` platform target — with `docs/design/{plan-validation-register,platform-strategy-research}.md` as its cited research base. Treat it as direction, not current state.

### Directory layout

```
src/              React frontend
  app/            Router (src/app/routes.tsx — all pages lazy-loaded via wouter)
  app/platform/   PlatformTarget seam + PlatformRouter + guards/ (WebOnlyGuard) — see "Platform routing seam"
  pages/          Route-level page components
  components/     Shared UI components (shadcn primitives in components/ui/)
  features/       Feature-scoped modules (alerts, auth, containers, equipment, inventory, profile, rooms, scan, settings, shift-adjustments, shift-chat, today)
  core/           Client hexagonal domain: entities/, ports/, use-cases/ (e.g. offline-emergency-block.ts) — pure TS, no framework imports
  infrastructure/ Adapters implementing core ports: api/, auth/, db/ (Dexie equipmentCache/syncQueue), platform/ (haptics/nfc/deepLink)
  native/         Capacitor shell composition: NativeShell, NativeTabBar, NativeTabSidebar, tablet/
  desktop/        WebShell (desktop web chrome)
  shell/          Legacy barrel re-exporting native/desktop shells — prefer direct imports
  hooks/          Auth, push, settings, offline sync hooks
  lib/            api.ts, offline-db.ts (Dexie), sync-engine.ts, i18n.ts (some concerns migrating into core/ + infrastructure/)
  types/          API-response + domain TypeScript types (per "API client pattern")
server/
  index.ts        Express entry — imports env-bootstrap FIRST, then registers routes
  db.ts           Drizzle pool + re-exports from schema/
  schema/         pgTable definitions (core, equipment, inventory, tasks, ops, er, integrations)
  migrate.ts      Migration runner (exports runMigrations())
  app/
    routes.ts     Registers ~46 API route modules
    start-schedulers.ts  Starts all BullMQ workers + background schedulers
  routes/         One file per API resource
  services/       Domain services (appointments, equipment, waitlist, inventory, restock, dispense, code-blue…)
  domain/         Hexagonal equipment evidence-graph + Asset Copilot (domain/equipment/**, service-task.adapter.ts)
  lib/            Business logic (billing, alerts, push, forecast, audit, queues, realtime/event-publisher, code-blue-keepalive, authority…)
  lib/authority/enforcement/ Evaluator families (stale, oprole, task-assignment, stale-task-ownership, code-blue-manager, clinical-invariant); each ships `off | shadow | enforce`
  jobs/runtime.ts BullMQ job runtime (charge-alert, expiry-check, stale-checkin-sweep)
  workers/        Worker implementations + in-process equipment/waitlist schedulers
  integrations/   External PMS adapter layer (webhook inbound/outbound, sync jobs)
  middleware/     auth.ts, rate-limiters.ts, tenant-context.ts, validate.ts, authority.ts
lib/              i18n utilities shared by frontend and backend (typed `t`, parity check, internal-key strip)
locales/          Translation files: en.json, he.json (Hebrew is default; user-facing copy says "Tasks")
shared/           Constants + types shared between frontend and backend
migrations/       SQL files run in order via pnpm db:migrate (also applied at server startup)
tests/            All vitest tests; some groups are excluded by default (see below). Phase 9 drills: deterministic counter contracts (`tests/phase-9-deterministic-drills.test.ts`) + Playwright browser harness (`tests/phase-9-drills.spec.ts`)
scripts/          Dev/ops scripts (includes scripts/i18n/check-parity.ts and scripts/i18n/generate-types.ts)
public/sw.js      Service worker (build-tag versioned cache, emergency endpoint denylist)
ios/ android/     Capacitor native shells (capacitor.config.ts at root) — build only via scripts/build-native-shell.sh
```

### Platform routing seam

`src/app/platform/` decides which shell renders. `PlatformTarget = "mobile" | "desktop" | "marketing"`; `resolvePlatformTarget()` (sync, safe at module-init) and `usePlatformTarget()` (reactive — re-evaluates on wouter navigation + `matchMedia` change) resolve in this order:

1. **Capacitor-native** → `mobile`
2. **marketing path** (`/signin`, `/signup`, `/privacy`, `/terms`, `/support`) → `marketing`
3. **touch-narrow** (`(max-width: 767px) and (pointer: coarse)` — installed PWA / mobile Safari) → `mobile`
4. else → `desktop`

- **`PlatformRouter`** (`src/app/platform/PlatformRouter.tsx`) wraps AppRoutes: `mobile → NativeShell` (owns safe-area, scroll, tab bar, MoreSheet); `desktop`/`marketing` → passthrough (each page's own `AppShell` owns web chrome).
- **`WebOnlyGuard`** (`src/app/platform/guards/WebOnlyGuard.tsx`, mount **inside** `AuthGuard`) gates desktop-dense / large-format surfaces — Command board, analytics, procurement, audit-log, QR/print pages, and the Code Blue wall displays. Capacitor-native → `Redirect` to `fallback`; browser below the 1024px desktop breakpoint → dark guard screen routing to the mobile view instead of an overflowing desktop layout. Re-grep `WebOnlyGuard` in `src/app/routes.tsx` for the exact current set before relying on it.
- The client shell layers live in `src/native/` (Capacitor), `src/desktop/` (`WebShell`), with `src/shell/` a legacy barrel. `src/core/` + `src/infrastructure/` are an **in-progress hexagonal migration** (branches `feat/P2-S1-infrastructure-adapters`, `feat/native-migration-phases-1-3`) — some concerns still live in `src/lib/*`; prefer the newer paths for new code, but don't assume the migration is complete.

### Multi-tenancy (critical rule)

Every DB table has a `clinicId` column. **Every query must filter by `clinicId`.** No exceptions. Dev-bypass hardcodes `clinicId = "dev-clinic-default"`.

### Frozen architecture surfaces (post-Phase-9)

These exist as load-bearing contracts. Extend or wire additively — do **not** replace, refactor, or weaken:

- **Realtime transport:** SSE via `/api/realtime/stream`, outbox-backed ordering on `vt_event_outbox`, monotonic `id:` cursor, HTTP replay via `/api/realtime/replay`. Not WebSockets, not polling.
- **BroadcastChannel envelope:** cross-tab gossip carries `cursor`, `buildTag`, `ts`, `senderNonce` and `kind ∈ { "cursor", "build_tag", "code_blue_seen" }`. Ordering is rooted in the monotonic outbox cursor; `ts` is advisory.
- **PWA build-tag:** `__VT_BUILD_TAG__` is the single source of truth for the SW cache name (`vettrack-<buildTag>`) and the split-version detector. Injected at build time into both `public/sw.js` and the client bundle.
- **Emergency endpoint cache denylist:** `/api/display/snapshot`, `/api/code-blue/sessions/active`, `/api/realtime/{stream,replay,outbox-head,telemetry}` — never read from or written to Cache Storage. The bypass is unconditional and pre-existing entries are purged on SW activate.
- **Enforcement envelope:** every evaluator family in `server/lib/authority/enforcement/*` is `off | shadow | enforce`, resolved per-clinic with a short TTL. `off` short-circuits the wiring; `shadow` runs but never denies; `enforce` may deny with a stable reason code.
- **Strategy A safety net:** the legacy shift-derived authority path stays byte-for-byte identical for clinics without an open `vt_clinical_check_ins` row. Strategy A is **not retired** — wiring-layer fallbacks degrade to `off` on resolver throw (CI-16/CI-20).
- **i18n key namespace:** `appointmentsPage.*` is frozen for internal compatibility — only the rendered copy was renamed to "Tasks" / "משימות" (Phase 6 §17). The `vt_appointments` table and `/api/appointments` route stay. The client page component was renamed `src/pages/appointments.tsx` → `src/pages/Tasks.tsx` (2026-07-04, sanctioned) — a client-file rename only; it does not touch the frozen server/table/key surfaces.
- **Audit `AuditActionType` union:** closed type; new audit kinds must be added to the union in `server/lib/audit.ts`, never inferred.
- **Telemetry cardinality:** every Phase 9 telemetry field is a bounded enum routed through `POST /api/realtime/telemetry` and a closed `incrementMetric()` union. No PII, no IPs, no UAs, no raw timestamps, no free-form labels.

### Auth modes

Resolved at startup by `server/lib/auth-mode.ts`:
- **clerk** — `CLERK_SECRET_KEY` present AND `CLERK_ENABLED !== "false"` → full Clerk JWT validation
- **dev-bypass** — otherwise (no secret, or `CLERK_ENABLED=false` explicitly) → hardcoded `DEV_USER` (admin, `clinicId = "dev-clinic-default"`)

`req.authUser` (set by `server/middleware/auth.ts`) is always populated before route handlers. **Role is always read from `vt_users.role` in the DB**, never from JWT claims.

Role hierarchy (numeric for comparison): `admin=40 · vet=30 · senior_technician=25 · lead_technician=22 · vet_tech=20 · technician=20 · student=10`

### Database schema

All tables prefixed `vt_`. Table definitions live in `server/schema/*.ts` (re-exported from `server/db.ts`). Generated inventory: `docs/audit/db.md` (`pnpm docs:audit`).

**Core:** `vt_clinics`, `vt_users`  
**Equipment:** `vt_equipment`, `vt_rooms`, `vt_docks`, `vt_equipment_waitlist`, `vt_staging_queue`, `vt_scan_logs`, …  
**Tasks:** `vt_appointments` (unified task model; UI route `/equipment/tasks`)  
**Emergency:** `vt_code_blue_sessions`, `vt_code_blue_log_entries`, `vt_crash_cart_*`  
**Inventory:** `vt_containers`, `vt_items`, `vt_dispense_events`, `vt_restock_*`, `vt_purchase_orders`  
**Ops:** `vt_shifts`, `vt_shift_sessions`, `vt_event_outbox`, `vt_clinical_check_ins`, `vt_audit_logs`  
**Integrations:** `vt_integration_configs`, sync log/conflict tables  

**Removed (migrations 142–143):** ER/patient/hospitalization tables, medication tasks, drug formulary, pharmacy forecast. See `docs/scope-change-2026.md`.

After editing schema files, run `npx drizzle-kit generate` → commit SQL → `pnpm db:migrate`.

### Realtime (Phase 9)

- One SSE connection per clinic: `GET /api/realtime/stream` (auth + `clinicId` required). Events carry an `id:` cursor sourced from `vt_event_outbox.id`.
- Replay: on reconnect, the server replays missed outbox rows after `Last-Event-ID`; if that id was pruned the server emits `reset_state:last_event_pruned` and the client triggers a full snapshot resync. `GET /api/realtime/replay` exposes the same path over HTTP.
- `KEEPALIVE` events (~10 s) carry `{ activeCodeBlueSessionId, stormHint }`. They are routed to keepalive subscribers only — they do **not** invalidate query caches. ≥50 connects per clinic in 5 s flips `stormHint=elevated` for 30 s.
- `useRealtimeReconciliation` wires `visibilitychange`, `pageshow` (BFCache), `online`, and Page Lifecycle `freeze`/`resume` to one debounced reconciliation path (replay + `forceResyncWardErCaches`).
- `BroadcastChannel("vt_realtime_outbox_cursor")` carries the cursor envelope, a build-tag gossip channel for split-version detection, and `code_blue_seen` gossip. Ordering uses the monotonic cursor; tabs never trust each other's clocks.
- All client telemetry posts (`duplicateDrop`, `gapResync`, `codeBluePropagationBucket`, `displayForcedResyncTrigger`, `splitVersionClientDetected`, `swUpdateConflict`, …) are bounded enums. Adding a new field requires updating both the client classifier and the closed enum check in `server/routes/realtime.ts`.

### Code Blue runtime guarantees (Phase 9)

- Emergency mutations — `POST /code-blue/sessions`, `POST /code-blue/sessions/:id/logs`, `PATCH /code-blue/sessions/:id/end`, `PATCH /code-blue/sessions/:id/presence` — require online execution. The classifier `classifyEmergencyEndpoint()` in `src/lib/offline-emergency-block.ts` intercepts these in the API client and **never** queues them for offline replay.
- Offline attempts surface a loud toast and increment a bounded `offline_emergency_mutation_blocked_*` counter. The local FIFO buffer (≤200, `sessionStorage`) is tab-scoped, never posted to the server, never persisted to IndexedDB.
- Session end is **server-confirmed**. The UI never optimistically marks a session ended; it follows the SSE event or a keepalive-driven snapshot reconciliation.
- Reconnect / wake recovery uses replay + snapshot reconciliation — no polling refresh fallback for emergency state.

### Offline-first / PWA (Phase 9)

- `src/lib/offline-db.ts` — Dexie (IndexedDB): equipment cache, rooms cache, pending sync queue.
- `src/lib/sync-engine.ts` — FIFO queue, retries, circuit-breaker; emits `Sentry.captureEvent` on permanent failures.
- Service Worker (`public/sw.js`) — cache name is `vettrack-<__VT_BUILD_TAG__>`; install precaches the shell + `self.skipWaiting()`; activate purges every non-current cache, claims clients, and posts `SW_UPDATED { buildTag }`.
- **Emergency endpoint cache bypass** is unconditional: `/api/display/snapshot`, `/api/code-blue/sessions/active`, `/api/realtime/{stream,replay,outbox-head,telemetry}` are never cached, and pre-existing entries are purged on activate. Do not add an emergency endpoint to any cache path.
- Build-tag mismatch detection: every BroadcastChannel envelope carries the loading bundle's build tag. A peer-tab divergence fires `splitVersionClientDetected` once and surfaces the SW-update banner — independent of the SW's own `swUpdateConflict` counter.
- `main.tsx` catches `ChunkLoadError` / dynamic-import failures, clears SW caches, and force-reloads once (sessionStorage loop guard, surface-tagged: `active | idle | kiosk`).

### Authority + enforcement (Phase 2.5 → Phase 5)

- `resolveAuthority()` (`server/lib/authority.ts`) is the single source of effective clinical authority. Order: open `vt_clinical_check_ins` row → shift-derived legacy branch (**Strategy A safety net**, byte-for-byte identical to pre-Phase-2.5 behavior). Strategy A is **not retired** — it carries every clinic that has not adopted the check-in path.
- Evaluator families in `server/lib/authority/enforcement/`: `stale.evaluator`, `oprole.evaluator`, `task-assignment.evaluator`, `stale-task-ownership.evaluator`, `code-blue-manager.evaluator`, `clinical-invariant.evaluator`. Each resolves per-clinic mode (`off | shadow | enforce`) with a short TTL.
- Wiring contract:
  - `off` — the evaluator path is short-circuited; no clinical-validation queries issue.
  - `shadow` — evaluator runs, never denies, emits bounded counters + a sampled audit row (e.g. `clinical_invariant_shadow_would_have_blocked`).
  - `enforce` — evaluator may return `deny`; the call site rolls back the mutation transaction and returns the documented status with a stable reason code (e.g. 422 `ORPHAN_DISPENSE_BLOCKED`).
- **Wiring-layer Strategy A safety net (CI-16/CI-20):** any resolver throw degrades to `off` at the call site so a transient failure cannot accidentally block a clinical mutation.
- **Fail-open carve-out:** `SMART_COP_VALIDATION_FAIL_OPEN=true` permits the evaluator to degrade to allow when its own DB reads throw; this emits `clinical_invariant_fail_open` (audit kind) so dashboards separate it from genuine `allow`.
- All audit kinds are members of the closed `AuditActionType` union in `server/lib/audit.ts`. Add new kinds to the union — never log a string the union doesn't include.

### Background workers + schedulers (BullMQ + Redis)

All workers and recurring schedulers are registered in `server/app/start-schedulers.ts`. Adding a new worker/scheduler = add the import + start call there.

| Worker / scheduler | Trigger |
|--------|---------|
| `expiryCheckWorker` (job runtime) | Daily cron 08:00 |
| `chargeAlertWorker` (job runtime) | Delayed job on return with `isPluggedIn=false` |
| `integration.worker` | Integration sync events |
| `staleCheckInSweepWorker` (job runtime) | Clinical check-in TTL sweep |
| `staleTaskOwnershipSweepWorker` | Task-ownership TTL sweep (shadow + enforcement) |
| `taskOwnershipBackfill.worker` | One-shot ownership backfill |
| `notification.worker` | Push fan-out |
| `startEventOutboxPublisher` | Realtime outbox publisher (drives SSE) |
| `startOutboxJanitor` / `startOutboxDlqScanner` | Outbox retention + DLQ health |
| `startCodeBlueReconciliationScanner` | Unreconciled Code Blue session sweep |

Redis is optional in dev (app runs; queues log `QUEUE_DISABLED_NO_REDIS`). Production requires Redis.

### i18n (Phase 6)

- Two locales, Hebrew default: `locales/he.json`, `locales/en.json`. Parity is enforced by `scripts/i18n/check-parity.ts` and `tests/i18n-parity.test.ts`.
- Frontend: import `t` from `@/lib/i18n` — typed against `src/lib/i18n.generated.d.ts`. Codegen runs via `scripts/i18n/generate-types.ts`.
- Backend: `req.locale` is set by `i18nMiddleware` from `Accept-Language` or `x-locale`. JSON error envelopes are produced by `apiError()` in `server/lib/apiError.ts` and rendered server-side per locale.
- `_meta.*` JSON keys are non-rendering metadata (Phase 6 §5 invariant 13) — included in parity, filtered out of the runtime accessor by `stripInternalKeys`.
- **Terminology:** user-facing copy uses **Tasks / משימות** for the unified task model. The `appointmentsPage.*` key namespace, the `vt_appointments` table, and the `/api/appointments` route are intentionally **not renamed** (Phase 6 §17 forbidden) — only the rendered copy changed. Exception carved out 2026-07-04: the client page file is `src/pages/Tasks.tsx` (renamed from `appointments.tsx`; guard tests updated in the same commit).
- **No hardcoded copy in source.** `tests/i18n-no-hebrew-in-source.test.ts` rejects Hebrew strings in `.ts`/`.tsx`. Hebrew belongs only in `locales/*.json`.
- Hebrew text never appears in identifiers, variable names, or file names.

### API client pattern

All server calls go through `src/lib/api.ts`. Every new endpoint needs:
1. A typed function exported from `src/lib/api.ts`
2. A corresponding TypeScript type in `src/types/`

### Audit logging

Use `logAudit()` from `server/lib/audit.ts` for all critical actions. It is fire-and-forget (never `await` it in a transaction path).

### Security

- Global body XSS sanitization via `xss` library
- Helmet CSP, HSTS, X-Frame-Options
- Rate limiting: 100 req/min global (GLOBAL_API_LIMITER_MAX_PER_MINUTE), 10/min scan actions, 20/min checkout/return
- Integration credentials encrypted with AES-256-GCM in `vt_server_config` when `DB_CONFIG_ENCRYPTION_KEY` is set

### Operational doctrine (what NOT to do)

- **No transport replacement.** Don't swap SSE for WebSockets, long-polling, or shared workers. Don't introduce a parallel realtime path.
- **No offline emergency queueing.** Code Blue mutations must fail loud when offline. Do not extend the sync engine to cover them.
- **No polling-based recovery for Code Blue.** Reconnect goes through replay + reconciliation; the snapshot endpoint is reached only via the bounded degraded-mode path.
- **No optimistic local termination of emergency state.** UI follows server confirmation.
- **No high-cardinality telemetry.** Every Phase 9 telemetry surface is a bounded enum. Don't add free-form labels, raw durations, IPs, UAs, or PII to metrics.
- **No weakening of authority semantics.** Evaluators must keep their `off | shadow | enforce` envelope and the Strategy A safety-valve fallback. Don't remove Strategy A; don't change `off` to issue clinical-validation queries.
- **No emergency endpoint in any cache.** Adding a Code Blue, snapshot, or realtime endpoint to Cache Storage is a regression.
- **No appointment → task renames of internal surfaces.** Rename copy only; the table, route, and `appointmentsPage.*` key namespace stay. (The client page file `src/pages/Tasks.tsx` is the one sanctioned rename — 2026-07-04.)
- **Realtime / PWA work needs browser verification.** Type-check and vitest cover counter contracts; the Playwright drills (`tests/phase-9-drills.spec.ts`) cover the live transport. Both should pass before claiming a Phase-9-adjacent change is done.

### Tests

`pnpm test` runs vitest. Several test groups are excluded by default in `vite.config.ts`:
- DB integration tests (require `DATABASE_URL` + applied migrations): `tests/restock.service.test.ts`, `tests/migrations/**`, `tests/phase-2-3-medication-package-integration.test.ts`, `tests/equipment-operational-state.integration.test.ts`, `tests/shift-chat-window.integration.test.ts`. Dedicated runners cover only a subset: `pnpm test:db-integration` (equipment-operational-state), `pnpm test:integration:ops` (operational-state + waitlist); the shift-chat test runs directly via `pnpm exec tsx tests/shift-chat-window.integration.test.ts`.
- Live-server tests (require dev server on :3001): `tests/charge-alert-worker.test.js`, `tests/code-blue-mode-equipment.test.js`, `tests/equipment-scan-e2e.test.js`, `tests/expiry-api.test.js`, `tests/expiry-check-worker.test.js`, `tests/returns-api.test.js`
- Phase 9 deterministic drills: `tests/phase-9-deterministic-drills.test.ts` covers bounded-counter contracts in unit form; `tests/phase-9-drills.spec.ts` is the Playwright browser harness for the eight realtime/PWA drills.

E2E tests use Playwright: `pnpm test:signup` (requires Chromium). The Phase 9 drills also use Playwright and require a running app — invoke through the dedicated `playwright.ui.config.ts` / `playwright.config.ts` runners.

### Adding a new feature (checklist)

1. Schema change in `server/schema/*.ts` (via `server/db.ts`) → `npx drizzle-kit generate` → commit the generated SQL (the runtime applies it at startup; `pnpm db:migrate` runs the same path on demand).
2. Route file in `server/routes/` → register in `server/app/routes.ts`.
3. If adding a BullMQ worker / scheduler → register in `server/app/start-schedulers.ts`.
4. API function in `src/lib/api.ts` + type in `src/types/`.
5. Page in `src/pages/` → add lazy import + `<Route>` in `src/app/routes.tsx`.
6. New user-facing copy → keys go in `locales/he.json` + `locales/en.json` (parity enforced); access via the typed `t.*` accessor.
7. New audit kind → add to the `AuditActionType` union in `server/lib/audit.ts`.
8. New realtime telemetry surface → bounded enum on both client and `server/routes/realtime.ts`, plus a closed-union counter in `server/lib/metrics.ts`.
9. Touching realtime / Code Blue / PWA? Read the "Frozen architecture surfaces" and "Operational doctrine (what NOT to do)" sections first.
10. Run `npx tsc --noEmit` — must pass zero errors.

### Cursor project rules

Claude Code and other IDE agents should respect `.cursor/rules/*.mdc`: `00-core-behavior.mdc` (identity + session-start protocol — read `CLAUDE.md`/`PLAN.md`/`TASKS.md` before coding), `01-anti-patterns.mdc` (tells that mark AI-generated code, e.g. comment theater), `02-workflow.mdc` (required phases, orient-first), `03-testing.mdc` (every code task ships or updates a test). All four are `alwaysApply: true`. Human summary of rollout and ongoing compliance: `docs/engineering-rules-rollout.md`.
