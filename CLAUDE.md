# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (Node ≥ 22.12 and < 25, pnpm 9.15.9 — pnpm workspace: root app + packages/*)
pnpm install
pnpm dev                    # API on :3001 + Vite on :5000 (kills ports first via predev)
pnpm dev:bypass             # dev with Clerk forced off (VITE_FORCE_DEV_BYPASS=true CLERK_ENABLED=false)

# Type checking — run after every file change (two tsconfigs: frontend + server)
pnpm typecheck               # tsc --noEmit (frontend) && tsc -p tsconfig.server.json --noEmit (server)
pnpm typecheck:server         # server tsconfig only
pnpm contracts:typecheck      # @vettrack/contracts package
pnpm rfid-controller:typecheck # packages/rfid-controller

# Tests
pnpm test                   # vitest unit/integration (excludes DB/live-server tests)
pnpm test -- --reporter=verbose  # with detail
pnpm test -- tests/some.test.ts  # single file
pnpm test:db-integration    # equipment-operational-state DB test (needs DATABASE_URL + migrations)
pnpm test:integration:ops   # equipment operational-state + waitlist integration tests
pnpm test:live-server       # the six live-server suites, gated on assertion COUNT (needs API on :3001)
pnpm test:rfid-controller   # packages/rfid-controller unit tests (own vitest config)
pnpm test:playwright:ci     # Playwright CI suite (Chromium). Suite selection is PW_SUITE env → allowlist in playwright.config.ts
pnpm test:playwright:phase9 # Phase 9 realtime/PWA drills (needs running app)
pnpm test:playwright:pwa    # PWA suite; also: :waitlist, :workday, :flow-walk, :ui-smoke
pnpm test:signup            # signup E2E flow

# Architecture gates (server/schema, module boundaries, dead code)
pnpm architecture:gates      # tsc (frontend + tsconfig.server-check.json) + depcruise + madge cycles + tenant scope + claim verification
pnpm tenant:lint:enforce     # every query filters clinicId. Fails on findings NOT in .tenant-lint-known-violations.json
pnpm tenant:lint:touched     # warn-only variant (touched files); reports, never fails
pnpm depcruise:check         # dependency-cruiser boundary check against known-violations baseline
pnpm architecture:cycles     # import-cycle regression check
pnpm knip                   # unused files/exports/deps (also not part of architecture:gates)

# Claim verification (the docs are checked, not trusted)
pnpm verify:claims           # every statement in a governed doc must be accounted for
pnpm verify:evidence         # run the declared gates and record the result (layer 3)

# i18n
pnpm i18n:check              # locales/en.json ⟷ locales/he.json parity

# Database
pnpm db:migrate             # apply pending migrations on demand (same path runs at server startup)
# Migrations are HAND-AUTHORED SQL — after a schema change, write the next
# migrations/NNN_description.sql yourself. drizzle-kit generate / push (pnpm db:push)
# are non-functional in this repo; see docs/migrations.md for why.

# Native shell (Capacitor — ios/ + android/ wrap the built web bundle). The iOS app is LIVE.
pnpm cap:build:native       # scripts/build-native-shell.sh --ios (use --android / --all via cap:build:native:android / :all)
pnpm cap:open:ios           # open Xcode project
pnpm cap:install:ios-sim    # install onto booted simulator
pnpm resubmit               # App Store version bump: same marketing version, build n+1 (rejection fix / re-upload)
pnpm resubmit:release       # new marketing version — pass MAJOR.MINOR.PATCH; version fields only, no app logic

# Other
pnpm build                  # frontend production build → dist/public
pnpm start                  # production server
pnpm worker                 # background job worker (requires Redis)
pnpm seed:dev               # seed dev database (server/seed.ts)
pnpm auth:preflight         # verify Clerk config + auth mode
pnpm validate:prod          # pre-deployment checks
pnpm docs:audit             # regenerate docs/audit inventories (db.md etc.)
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
- At the start of every session, invoke the `vettrack-team` skill (Skill tool) and route work through its personality roster.

## Architecture

VetTrack is a veterinary hospital operations platform: equipment tracking & custody, Code Blue emergency workflows, inventory/dispense, tasks & shifts, and external PMS integrations for multi-clinic deployments. (Legacy `/patients`, `/er`, `/billing`, `/meds` routes survive only as redirects — see scope note below.)

**Stack:** React 18 + Vite frontend (port 5000) · Express + TypeScript backend (port 3001) · PostgreSQL + Drizzle ORM · BullMQ + Redis · Clerk auth · SSE realtime (+ additive Socket.io collab channel) · PWA / offline-first · Capacitor 8 native shell (iOS/Android, live on the App Store) <!-- vt-claim: attested ios-app-store-live --> · Sentry · Railway deploy

**Active program:** `docs/design/program-plan.md` is the forward-looking program — per-role UX, the web app as a management console, and the Command Center board as a fourth `"board"` platform target — with `docs/design/{plan-validation-register,platform-strategy-research}.md` as its cited research base. Parts have since landed (the `"board"` target, `src/features/command-board`, the web console pages); treat the doc as direction and verify against the code for current state. The mobile-native successor is an Expo SDK 57 migration (CNG / prebuild, New Architecture mandatory) in a separate public repo (`VetTrack---RN-Migration-`; owner decision 2026-07-22; the old Expo companion `literate-dollop` is retired and no longer exists — verified against the owner's repo list 2026-07-28). `packages/contracts` (`@vettrack/contracts`) remains the framework-free shared layer; contract bumps may need a companion PR in that successor repo.

### Directory layout

```
src/              React frontend
  app/            Router (src/app/routes.tsx — all pages lazy-loaded via wouter)
  app/platform/   PlatformTarget seam + PlatformRouter + guards/ (WebOnlyGuard) — see "Platform routing seam"
  pages/          Route-level page components
  components/     Shared UI components (shadcn primitives in components/ui/)
  features/       Feature-scoped modules (alerts, analytics, auth, code-blue, collab, command-board, containers, equipment, inventory, profile, scan, settings, shift-adjustments, shift-chat, today)
  board/          BoardShell + kiosk co-presence/auto-reload hooks for the /board Command Center target
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
    routes.ts     Registers 60 API route mounts (57 distinct routers)
    start-schedulers.ts  Starts all BullMQ workers + background schedulers
  routes/         One file per API resource (incl. rfid, admin-rfid-*, shift-handover, clinic-join, whatsapp)
  services/       Domain services (appointments, equipment, waitlist, inventory, restock, dispense, code-blue…)
  domain/         Hexagonal equipment evidence-graph + Asset Copilot (domain/equipment/**, service-task.adapter.ts)
  lib/            Business logic (billing, alerts, push, forecast, audit, queues, realtime/event-publisher, code-blue-keepalive, authority…)
  lib/authority/enforcement/ Evaluator families (stale, oprole, task-assignment, stale-task-ownership, code-blue-manager, clinical-invariant); each ships `off | shadow | enforce`
  lib/rfid/       RFID config, HMAC provisioning/secret rotation, reader-offline + finalizing sweeps
  lib/realtime-collab/ R-RTC-1 Socket.io collab channel (/collab-ws) — ephemeral presence only, see "Realtime"
  jobs/runtime.ts BullMQ job runtime (charge-alert, expiry-check, stale-checkin-sweep)
  workers/        Worker implementations + in-process equipment/waitlist schedulers
  integrations/   External PMS adapter layer (webhook inbound/outbound, sync jobs)
  middleware/     auth.ts, rate-limiters.ts, tenant-context.ts, validate.ts, authority.ts
lib/              i18n utilities shared by frontend and backend (typed `t`, parity check, internal-key strip)
locales/          Translation files: en.json, he.json (Hebrew is default; user-facing copy says "Tasks")
shared/           Constants + types shared between frontend and backend
packages/         pnpm workspace packages:
  contracts/      @vettrack/contracts — shared contract types (emergency, pending-sync); also consumed by the external RN mobile repo (successor to the retired literate-dollop)
  rfid-controller/ Vendor-agnostic RFID signing middleware core (ADR-005/006) — emits signed batches to POST /api/rfid/events; no runtime deps, own vitest config
migrations/       SQL files run in order via pnpm db:migrate (also applied at server startup)
tests/            All vitest tests; some groups are excluded by default (see below). Phase 9 drills: deterministic counter contracts (`tests/phase-9-deterministic-drills.test.ts`) + Playwright browser harness (`tests/phase-9-drills.spec.ts`)
scripts/          Dev/ops scripts (includes scripts/i18n/check-parity.ts and scripts/i18n/generate-types.ts)
public/sw.js      Service worker (build-tag versioned cache, emergency endpoint denylist)
ios/ android/     Capacitor native shells (capacitor.config.ts at root) — build only via scripts/build-native-shell.sh
```

### Platform routing seam

`src/app/platform/` decides which shell renders. `PlatformTarget = "mobile" | "desktop" | "marketing" | "board"`; `resolvePlatformTarget()` (sync, safe at module-init) and `usePlatformTarget()` (reactive — re-evaluates on wouter navigation + `matchMedia` change) resolve in this order:

1. **Capacitor-native** → `mobile`
2. **marketing path** (`/signin`, `/signup`, `/privacy`, `/terms`, `/support`) → `marketing`
3. **board path** (`/board`, `/board/pair`) → `board` (before touch-narrow, so a coarse-pointer tablet/TV browser at `/board` gets the kiosk, not the mobile shell)
4. **touch-narrow** (`(max-width: 767px) and (pointer: coarse)` — installed PWA / mobile Safari) → `mobile`
5. else → `desktop`

- **`PlatformRouter`** (`src/app/platform/PlatformRouter.tsx`) wraps AppRoutes: `mobile → NativeShell` (owns safe-area, scroll, tab bar, MoreSheet); `board → BoardShell` (`src/board/BoardShell.tsx` — dark full-bleed kiosk host for the canonical `/board` Command Center); `desktop`/`marketing` → passthrough (each page's own `AppShell` owns web chrome).
- **`WebOnlyGuard`** (`src/app/platform/guards/WebOnlyGuard.tsx`, mount **inside** `AuthGuard`) gates desktop-dense / large-format surfaces — Command board, analytics, procurement, audit-log, QR/print pages, and the Code Blue wall displays. Capacitor-native → `Redirect` to `fallback`; browser below the 1024px desktop breakpoint → dark guard screen routing to the mobile view instead of an overflowing desktop layout. Re-grep `WebOnlyGuard` in `src/app/routes.tsx` for the exact current set before relying on it.
- The client shell layers live in `src/native/` (Capacitor), `src/desktop/` (`WebShell`), with `src/shell/` a legacy barrel. `src/core/` + `src/infrastructure/` are an **in-progress hexagonal migration** (branches `feat/P2-S1-infrastructure-adapters`, `feat/native-migration-phases-1-3`) — some concerns still live in `src/lib/*`; prefer the newer paths for new code, but don't assume the migration is complete.

### Multi-tenancy (critical rule)

Every DB table has a `clinicId` column. **Every query must filter by `clinicId`.** No exceptions. Dev-bypass hardcodes `clinicId = "dev-clinic-default"`.

**This is now machine-enforced, and the enforcement is baseline-relative.** `pnpm tenant:lint:enforce`
runs inside `pnpm architecture:gates` and in CI, and fails on any finding **not** in
`.tenant-lint-known-violations.json` — a frozen set of ~200 hand-reviewed findings, keyed
`file::table` with a count rather than `file:line` so an unrelated edit above a finding does not
read as a regression. A new unscoped `.from(<tenantTable>)` fails the build and names the
`file:line:column`. If a finding is a genuine false positive, waive it in place with
`// tenant-lint:scoped <reason>`; regenerate the baseline only to record a deliberate decision.

### Frozen architecture surfaces (post-Phase-9)

These exist as load-bearing contracts. Extend or wire additively — do **not** replace, refactor, or weaken:

- **Realtime transport:** SSE via `/api/realtime/stream`, outbox-backed ordering on `vt_event_outbox`, monotonic `id:` cursor, HTTP replay via `/api/realtime/replay`. Not WebSockets, not polling. (The R-RTC-1 Socket.io channel on `/collab-ws` is a sanctioned **additive** exception for ephemeral collaboration state only — see below.)
- **Collab channel is ephemeral-only:** `/collab-ws` (`server/lib/realtime-collab/`) carries presence/cursors/typing/nudges. It **never** carries domain or emergency state, and its init is non-fatal — any failure logs and leaves it disabled while SSE and Code Blue start normally (R-RTC-1.7).
- **RFID is advisory-only (ADR-006, binding):** RFID is supporting evidence — it **never** overrides a human-confirmed room. Canonical location precedence: active checkout/scan > human `roomId` > RFID last-seen > free-text > unknown. Low-confidence/conflicting reads raise `rfid_location_conflict` / `ambiguous_rfid_location` for a human to resolve; the system never guesses. Ingest is HMAC-signed vendor-controller POSTs to `/api/rfid/events` (raw body parsed before `express.json()`, no Clerk session; per-clinic secrets with rotation via `server/lib/rfid/provisioning.ts`).
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

**Clinic join codes (ADR-007):** invite-free sign-up membership via `server/routes/clinic-join.ts`. `POST /auth/join-clinic` is deliberately identity-only (not `requireAuth` — a clinic-less user would 403 `MISSING_CLINIC_ID` before provisioning). A join code confers **pending** membership only (`status "pending"`, role `technician`; admin-email allowlist excepted); admins manage the code via `GET /admin/clinic-join-code` + `POST /admin/clinic-join-code/rotate`.

### Database schema

All tables prefixed `vt_`. Table definitions live in `server/schema/*.ts` (re-exported from `server/db.ts`). Generated inventory: `docs/audit/db.md` (`pnpm docs:audit`).

**Core:** `vt_clinics`, `vt_users`  
**Equipment:** `vt_equipment`, `vt_rooms`, `vt_docks`, `vt_equipment_waitlist`, `vt_staging_queue`, `vt_scan_logs`, …  
**Tasks:** `vt_appointments` (unified task model; UI route `/equipment/tasks`)  
**Emergency:** `vt_code_blue_sessions`, `vt_code_blue_log_entries`, `vt_crash_cart_*`  
**Inventory:** `vt_containers`, `vt_items`, `vt_dispense_events`, `vt_restock_*`, `vt_purchase_orders`  
**Ops:** `vt_shifts`, `vt_shift_sessions`, `vt_shift_handover` (migration 177), `vt_event_outbox` + `vt_event_outbox_seq` (migration 186, ADR-011), `vt_clinical_check_ins`, `vt_audit_logs`  
**RFID:** `vt_equipment_rfid_reads` (migration 138), `vt_rfid_readers` (migration 172; amended 174), `vt_rfid_secret_rotations` (migration 173; amended 176), `vt_rfid_egress_signals` (migration 175) — migration SQL is the source of truth for the composite-FK details  
**Integrations:** `vt_integration_configs`, sync log/conflict tables  

**Removed (migrations 142–143):** ER/patient/hospitalization tables, medication tasks, drug formulary, pharmacy forecast. See `docs/scope-change-2026.md`.

After editing schema files, hand-write the next `migrations/NNN_description.sql` (check `migrations/` for the current tail, and make every statement idempotent) → commit it → `pnpm db:migrate`. `drizzle-kit generate` is **not** the authoring path here — see [`docs/migrations.md`](docs/migrations.md).

### Realtime (Phase 9)

- One SSE connection per clinic: `GET /api/realtime/stream` (auth + `clinicId` required). Events carry an `id:` cursor sourced from `vt_event_outbox.id`, **and a `clinicSeq` from `vt_event_outbox.clinic_seq`** (ADR-011). `id` is global and drives ordering, `Last-Event-ID` resume and replay; `clinicSeq` is per-clinic and is the ONLY field gap detection may assert contiguity on — a client sees just its own clinic's subset of the global id, so that subset is never contiguous. `clinic_seq` is assigned by a BEFORE INSERT trigger (migration 186), not by application code, because two insert paths exist.
- Replay: on reconnect, the server replays missed outbox rows after `Last-Event-ID`; if that id was pruned the server emits `reset_state:last_event_pruned` and the client triggers a full snapshot resync. `GET /api/realtime/replay` exposes the same path over HTTP.
- `KEEPALIVE` events (~10 s) carry `{ activeCodeBlueSessionId, stormHint }`. They are routed to keepalive subscribers only — they do **not** invalidate query caches. ≥50 connects per clinic in 5 s flips `stormHint=elevated` for 30 s.
- `useRealtimeReconciliation` wires `visibilitychange`, `pageshow` (BFCache), `online`, and Page Lifecycle `freeze`/`resume` to one debounced reconciliation path (replay + `forceResyncWardErCaches`).
- `BroadcastChannel("vt_realtime_outbox_cursor")` carries the cursor envelope, a build-tag gossip channel for split-version detection, and `code_blue_seen` gossip. Ordering uses the monotonic cursor; tabs never trust each other's clocks.
- All client telemetry posts (`duplicateDrop`, `gapResync`, `codeBluePropagationBucket`, `displayForcedResyncTrigger`, `splitVersionClientDetected`, `swUpdateConflict`, …) are bounded enums. Adding a new field requires updating both the client classifier and the closed enum check in `server/routes/realtime.ts`.
- **Collab channel (R-RTC-1):** Socket.io on path `/collab-ws` (`server/lib/realtime-collab/`, initialized non-fatally in `server/index.ts`; client in `src/features/collab/`). Ephemeral-only: presence, cursors, selections, typing, nudges, board co-presence. Per-verb rate limits, byte caps, room-join authorization, Redis adapter when available (in-process fallback governed by config). It shares the HTTP server but is fully separate from SSE — it must never carry domain or emergency state, and a collab failure must never take down the main server.

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
| `integration.worker` + integration schedule/retention crons | Integration sync events |
| `staleCheckInSweepWorker` (job runtime) | Clinical check-in TTL sweep |
| `staleTaskOwnershipSweepWorker` | Task-ownership TTL sweep (shadow + enforcement) |
| `taskOwnershipBackfill.worker` | One-shot ownership backfill |
| `notification.worker` | Push fan-out |
| `startEventOutboxPublisher` | Realtime outbox publisher (drives SSE) |
| `startOutboxJanitor` / `startOutboxDlqScanner` | Outbox retention + DLQ health |
| `startCodeBlueReconciliationScanner` | Unreconciled Code Blue session sweep |
| Equipment operational-state workers | `equipmentConditionStaleness`, `stagingExpiry`, `equipment-waitlist-reservation`, `staleCheckoutSweep`, `stale-returned-sweep`, `sweep-escalation` |
| `startShiftHandoverScheduler` (R-SH-F1.2) | Shift-end handover generation — in-process only, deliberately no public generate route |
| `startRfidReaderOfflineSweep` / `startRfidFinalizingSweep` | Reader heartbeat staleness → `rfid_reader_offline` signal; reclaim crash-stranded `finalizing` secret-rotation rows |
| `scanUnresolvedEmergencyDispenses` (interval) | Unresolved emergency dispense escalation (30/60/120-min thresholds) |

Redis is optional in dev (app runs; queues log `QUEUE_DISABLED_NO_REDIS`). Production requires Redis.

### Claim verification (the docs are checked, not trusted)

`pnpm verify:claims` resolves every statement in a governed document against reality, and the same engine
runs inside `pnpm test` (`tests/claims-ledger.test.ts`) and `pnpm architecture:gates` — so a document that
starts lying fails CI. It exists because `CLAUDE.md` is the map everyone works from, and
`docs/audit/PROOF_ALIGNMENT_LOG.md` is 8,700 lines of "verify before reporting done" kept entirely by
whoever remembers it. The port's first run found `docs/migrations.md` describing ~~`drizzle.config.ts`~~ in the
present tense, five days after commit `b043585de` deleted it.

**Four layers.** *Exists* — paths, line ranges, globs, dependency versions, package scripts, the directory
layout, declared absence. *Executed* — a "MERGED"/"landed" line must cite a PR or commit, and that citation
must exist and be an ancestor of `main`. *Works* — the gates in `verify.config.json` must have run green on
this tree (`docs/audit/evidence-run.json`, written by `pnpm verify:evidence`, never committed). *Attested* —
what the repo cannot prove (the App Store, a device) is a dated entry in `docs/attestations.json` with an
expiry and a re-verify recipe.

Every claim ends as `verified` · `registered` · `attested` · `excluded by rule` · **FAIL**. There is no
"skipped": a silent skip and a passing check look identical from outside, and only one of them is honest.
One sixth label exists and is not an exception: on a tree where layer 2 cannot run at all (a shallow clone,
no `main`), commit and pull-request claims are counted `unresolvable` so the dispositions still sum to the
total. It appears only on a run that is **already failing** on `git-unavailable`, never on a passing one.

**When it fails, pick one — never a fourth option:** fix the document (the common case); or add an entry to
`docs/claims-registry.json` with an auditable reason if the claim is true but unverifiable here; or add an
entry to `docs/attestations.json` if it needs a human on real hardware. Exemptions cannot rot — an entry
that matches no live claim fails, and so does one whose claim would now verify on its own.

**Writing claims:** cite files in backticks; a shorthand that resolves as a path suffix is fine. Superseded
values go in `~~strikethrough~~`, and `X` → `Y` / "renamed from `X`" mark `X` as a former name — so the
repo's correction style stays safe to write. Close every strikethrough you open: an unterminated run blanks
the rest of the document and its claims would vanish, so the gate reports the run instead (a `` `~~` `` inside
a code span is literal text and opens nothing). Two things prose cannot express unambiguously use an HTML
comment: `<!-- vt-claim: absent drizzle-kit scope=deps -->` and `<!-- vt-claim: attested <id> -->`. A marker
inside backticks is an EXAMPLE, not a claim — which is what makes this sentence safe to write, and what stops
a documented `attested <id>` from satisfying the "referenced by a governed document" rule on its own.

**`docs/audit/PROOF_ALIGNMENT_LOG.md` is append-only, and the gate respects that:** it checks only the lines
a branch ADDS. A new entry must be verifiable now; the 348 historical entries stay the record they are,
which is what that file's own first rule requires.

Scope lives in `verify.config.json`. A document that is not listed is deliberately ungoverned, not
accidentally missed.

**The engine is shared with the RN migration repo and cannot drift quietly.** `scripts/verify/*.cjs` here is
the same code that repo carries as `scripts/verify/*.js` (this package is `"type": "module"`, so the copies
differ only in the extension inside their internal `require` calls). Nothing offline can compare two
repositories, so `scripts/verify/fingerprint.cjs` hashes the engine with that one difference normalised away,
both repos record the result in `verify.config.json` as `engineFingerprint`, and the gate fails when the local
files stop matching it. Editing the engine therefore costs a deliberate, reviewable line that says the shared
code changed — which is the moment to port it. The hash covers the fingerprint module itself, so the rule that
decides what counts as drift cannot drift for free.

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

- **No transport replacement.** Don't swap SSE for WebSockets, long-polling, or shared workers. Don't introduce a parallel realtime path for domain state. The `/collab-ws` Socket.io channel is the one sanctioned addition and it stays ephemeral-only — never route domain or emergency state through it.
- **No offline emergency queueing.** Code Blue mutations must fail loud when offline. Do not extend the sync engine to cover them.
- **No polling-based recovery for Code Blue.** Reconnect goes through replay + reconciliation; the snapshot endpoint is reached only via the bounded degraded-mode path.
- **No optimistic local termination of emergency state.** UI follows server confirmation.
- **No high-cardinality telemetry.** Every Phase 9 telemetry surface is a bounded enum. Don't add free-form labels, raw durations, IPs, UAs, or PII to metrics.
- **No weakening of authority semantics.** Evaluators must keep their `off | shadow | enforce` envelope and the Strategy A safety-valve fallback. Don't remove Strategy A; don't change `off` to issue clinical-validation queries.
- **No emergency endpoint in any cache.** Adding a Code Blue, snapshot, or realtime endpoint to Cache Storage is a regression.
- **No appointment → task renames of internal surfaces.** Rename copy only; the table, route, and `appointmentsPage.*` key namespace stay. (The client page file `src/pages/Tasks.tsx` is the one sanctioned rename — 2026-07-04.)
- **No RFID-as-authority.** RFID reads must never override a human-confirmed room (ADR-006's binding invariant). Conflicts raise signals for human resolution.
- **Realtime / PWA work needs browser verification.** Type-check and vitest cover counter contracts; the Playwright drills (`tests/phase-9-drills.spec.ts`) cover the live transport. Both should pass before claiming a Phase-9-adjacent change is done.

### Tests

`pnpm test` runs vitest. Several test groups are excluded by default in `vite.config.ts`:
- DB integration tests (require `DATABASE_URL` + applied migrations): `tests/restock.service.test.ts`, `tests/migrations/**`, `tests/equipment-operational-state.integration.test.ts`, `tests/shift-chat-window.integration.test.ts`, `tests/seed-reviewer-demo.integration.test.ts`, `tests/doctor-shift-gate.integration.test.ts`, `tests/tenant-pooling-isolation.integration.test.ts`. Dedicated runners cover only a subset: `pnpm test:db-integration` (`vitest.db-integration.config.ts` — equipment-operational-state, seed-reviewer-demo, doctor-shift-gate; **CI runs the latter two by name** inside the `integration-ops` job rather than this whole config, because equipment-operational-state fails under this config's ordering while passing under the ops one), `pnpm test:integration:ops` (operational-state + waitlist), `pnpm test:rls-pooling` (`vitest.rls-pooling.config.ts` — tenant-pooling-isolation; runs real DDL, needs `RLS_POOLING_PROBE=1` + `RLS_PROBE_DATABASE_URL` pointed at a throwaway database); the shift-chat test runs directly via `pnpm exec tsx tests/shift-chat-window.integration.test.ts`. `tests/restock.service.test.ts` and `tests/migrations/**` have no runner — invoke them directly via `pnpm exec tsx <file>`.
- Live-server tests (require dev server on :3001): `tests/charge-alert-worker.test.js`, `tests/code-blue-mode-equipment.test.js`, `tests/equipment-scan-e2e.test.js`, `tests/expiry-api.test.js`, `tests/expiry-check-worker.test.js`, `tests/returns-api.test.js`. ~~No workflow named any of them.~~ *Corrected 2026-08-22:* they now run in CI's `live-server` job via `pnpm test:live-server` (`scripts/ci/live-server-tests.mjs`), and the merge gate depends on it. **The runner gates on the reported assertion count, not just the exit code** — each suite ends with `if (failed > 0) process.exit(1)`, so a suite that asserted nothing exits 0; `scripts/ci/live-server-assertion-floors.json` records what each one ran (74 total) and a shortfall is a failure. The job seeds `eq1` via `pnpm seed:dev:e2e` first, because without that fixture `equipment-scan-e2e` reports 29 assertions instead of 31 rather than merely failing one
- Phase 9 deterministic drills: `tests/phase-9-deterministic-drills.test.ts` covers bounded-counter contracts in unit form; `tests/phase-9-drills.spec.ts` is the Playwright browser harness for the eight realtime/PWA drills.

E2E tests use Playwright: `pnpm test:signup` (requires Chromium). The Phase 9 drills also use Playwright and require a running app — invoke through the dedicated `playwright.ui.config.ts` / `playwright.config.ts` runners. Playwright discovery is allowlist-only via the `PW_SUITE` env var (default `ci`). Server-side smoke tests run via `pnpm test:server:smoke` (tsx-executed, not vitest). The `packages/rfid-controller` tests run separately via `pnpm test:rfid-controller`.

### Adding a new feature (checklist)

1. Schema change in `server/schema/*.ts` (via `server/db.ts`) → hand-write `migrations/NNN_description.sql` → commit it (the runtime applies it at startup; `pnpm db:migrate` runs the same path on demand). See [`docs/migrations.md`](docs/migrations.md) — `drizzle-kit generate` is non-functional in this repo.
2. Route file in `server/routes/` → register in `server/app/routes.ts`.
3. If adding a BullMQ worker / scheduler → register in `server/app/start-schedulers.ts`.
4. API function in `src/lib/api.ts` + type in `src/types/`.
5. Page in `src/pages/` → add lazy import + `<Route>` in `src/app/routes.tsx`.
6. New user-facing copy → keys go in `locales/he.json` + `locales/en.json` (parity enforced); access via the typed `t.*` accessor.
7. New audit kind → add to the `AuditActionType` union in `server/lib/audit.ts`.
8. New realtime telemetry surface → bounded enum on both client and `server/routes/realtime.ts`, plus a closed-union counter in `server/lib/metrics.ts`.
9. Touching realtime / Code Blue / PWA? Read the "Frozen architecture surfaces" and "Operational doctrine (what NOT to do)" sections first.
10. Hard-to-reverse or cross-boundary decisions need an ADR: `docs/architecture/adr/` (copy `template.md`, check `TRIGGERS.md` for when one is required, link `ADR-NNN` from the implementation PR).
11. Run `npx tsc --noEmit` — must pass zero errors.

### Cursor project rules

Claude Code and other IDE agents should respect `.cursor/rules/*.mdc`: `00-core-behavior.mdc` (identity + session-start protocol — read `CLAUDE.md`/`PLAN.md`/`TASKS.md` before coding), `01-anti-patterns.mdc` (tells that mark AI-generated code, e.g. comment theater), `02-workflow.mdc` (required phases, orient-first), `03-testing.mdc` (every code task ships or updates a test). All four are `alwaysApply: true`. Human summary of rollout and ongoing compliance: `docs/engineering-rules-rollout.md`.
