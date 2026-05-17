# VetTrack

Veterinary hospital operations platform — equipment tracking, medication workflows, inventory, scheduling, billing, and external PMS integrations for multi-clinic deployments.

**Stack:** React 18 + Vite + TypeScript · Express + Node.js · PostgreSQL + Drizzle ORM · BullMQ + Redis · Clerk auth · PWA/offline-first · Railway deployment

---

## Quick Start (Local Development)

### Prerequisites
- Node.js >= 22.12.0 (`nvm use` to match `.nvmrc`)
- pnpm 9.15.9
- PostgreSQL (local or hosted)
- Redis (optional — required for background jobs, automation engine, push notifications)

### Setup

```bash
pnpm install
cp .env.example .env        # fill in DATABASE_URL, CLERK keys, etc.
pnpm db:migrate             # run all migrations
pnpm dev                    # starts API on :3001 + frontend on :5000
```

See [`docs/dev-signin-runbook.md`](docs/dev-signin-runbook.md) for auth setup details.

### Available Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start API (:3001) + frontend (:5000) concurrently |
| `pnpm build` | Build frontend for production |
| `pnpm start` | Start production server |
| `pnpm worker` | Start background job worker (requires Redis) |
| `pnpm test` | Run vitest unit/integration tests |
| `pnpm db:migrate` | Run pending database migrations |
| `pnpm validate:prod` | Pre-deployment validation checks |
| `pnpm auth:preflight` | Verify Clerk auth configuration |
| `pnpm sync:formulary` | Sync drug formulary seed to all clinics |

---

## Architecture

```
vettrack/
├── src/              React frontend (PWA, offline-first, RTL-capable)
│   ├── app/          App routing (all pages lazy-loaded)
│   ├── pages/        Route-level page components
│   ├── components/   Shared UI components
│   ├── features/     Feature-scoped modules (auth, containers)
│   └── hooks/        React hooks (auth, push, settings, offline sync)
├── server/           Express API + business logic
│   ├── routes/       ~49 API route handlers (registered via server/app/routes.ts)
│   ├── services/     Core domain services (appointments, medication, inventory, dispense, er...)
│   ├── lib/          Business logic (billing, alerts, audit, push, realtime, queues, authority, enforcement...)
│   ├── workers/      BullMQ background job workers
│   ├── integrations/ External PMS adapter layer
│   └── db.ts         Drizzle ORM schema (all tables)
├── shared/           Code shared between frontend and backend
├── migrations/       SQL migration files (run in order via pnpm db:migrate)
├── scripts/          Dev/ops scripts
├── tests/            Static-analysis + integration tests (vitest)
├── lib/              i18n locale utilities
└── locales/          Translation files (en, he)
```

### Key Architecture Rules

1. **Every DB row is clinic-scoped** — every query must filter by `clinicId`. No exceptions.
2. **Migrations** — pending SQL files in `migrations/` are applied by `runMigrations()` at startup and by `pnpm db:migrate` on demand. After editing `server/db.ts`, run `npx drizzle-kit generate` to author the next file and commit it.
3. **Medication inventory deduction is async** — `completeTask` commits billing + completion in a transaction, then BullMQ handles inventory deduction. A 10-minute recovery loop re-enqueues stale jobs.
4. **Auth modes** — dev mode uses a hardcoded admin user. Production requires `CLERK_SECRET_KEY` + `VITE_CLERK_PUBLISHABLE_KEY`.
5. **Redis is required for background jobs** — BullMQ workers for notifications, inventory deduction, and integration sync all require Redis.
6. **Role resolution is always from the DB** — never from JWT claims. `req.authUser.role` comes from `vt_users.role`.
7. **Credentials are encrypted at rest** — integration API keys stored in `vt_server_config` via AES-256-GCM when `DB_CONFIG_ENCRYPTION_KEY` is set.

### Database Tables (all prefixed `vt_`)

**Core:** `vt_users`, `vt_clinics`, `vt_animals`, `vt_owners`  
**Equipment:** `vt_equipment`, `vt_rooms`, `vt_scan_logs`, `vt_return_logs`  
**Scheduling:** `vt_appointments` (unified task model; `taskType = "medication"` for meds), `vt_shifts`, `vt_shift_sessions`  
**Authority / Clinical safety:** `vt_clinical_check_ins`, `vt_task_ownership_confirm_queue`, `vt_event_outbox`  
**Inventory & Billing:** `vt_items`, `vt_containers`, `vt_billing_ledger`, `vt_billing_items`, `vt_inventory_jobs`  
**Procurement:** `vt_purchase_orders`, `vt_po_lines`  
**Hospitalization:** `vt_hospitalizations`, `vt_code_blue_sessions`, `vt_code_blue_log_entries`, `vt_code_blue_events` (legacy archive)  
**Comms:** `vt_push_subscriptions`, `vt_scheduled_notifications`  
**Observability:** `vt_audit_logs`, `vt_bulk_audit_log`  
**Config:** `vt_server_config`, `vt_formulary`, `vt_support_tickets`  
**Integration:** `vt_integration_configs`, `vt_integration_sync_log`

> User-facing copy now uses **Tasks** for the unified task model. The `vt_appointments` table, the `/api/appointments` route, and the `appointmentsPage.*` i18n key namespace are intentionally **not renamed** (Phase 6 §17) — only the rendered copy changed.

---

## Realtime, Code Blue, and PWA architecture

These surfaces are **frozen architecture** — extend them, do not replace them.

### Realtime (Phase 9)

- **Transport:** server-sent events (SSE) over a single per-clinic `/api/realtime/stream` connection. **Not** WebSockets, **not** polling.
- **Outbox-backed ordering:** every realtime event is published from `vt_event_outbox`. SSE delivers them with a monotonic `id:` cursor; replays use `Last-Event-ID` or `GET /api/realtime/replay?after=...`.
- **Replay / reconciliation:** the SSE handler replays missed outbox rows on reconnect. If the client's `Last-Event-ID` points at a pruned row the server emits `reset_state:last_event_pruned` and the client triggers a full snapshot resync. `useRealtimeReconciliation` wires `visibilitychange`, `pageshow` (BFCache), `online`, and Page Lifecycle resume to the same path.
- **BroadcastChannel:** cross-tab gossip uses a versioned envelope (`cursor`, `build_tag`, `code_blue_seen`) keyed by the monotonic outbox cursor; client wall-clock never participates in ordering.
- **Split-version detection:** every envelope carries the current `__VT_BUILD_TAG__`. A peer-tab tag mismatch increments `split_version_client_detected` and surfaces the SW-update banner once per loaded bundle.
- **Keepalive + storm detection:** `KEEPALIVE` events fire every ~10 s carrying `{ activeCodeBlueSessionId, stormHint }`. Keepalives are routed to a separate subscriber set and never invalidate query caches. ≥50 SSE connects per clinic in 5 s elevates `stormHint=elevated` for 30 s.
- **Degraded mode:** when keepalive reconciliation cannot confirm the active Code Blue session id, the client emits `realtime_emergency_degraded` and falls back to bounded polling of the snapshot endpoint until recovered.

### Code Blue runtime guarantees (Phase 9)

- All Code Blue mutations (`POST /sessions`, `POST /sessions/:id/logs`, `PATCH /sessions/:id/end`, `PATCH /sessions/:id/presence`) require an online server round-trip. They **must never** be queued for offline replay.
- The offline emergency-block layer (`src/lib/offline-emergency-block.ts`) intercepts these endpoints in the API client, fails loudly with a toast, and increments a bounded `offline_emergency_mutation_blocked_*` counter. The local FIFO buffer stays tab-scoped in `sessionStorage` and is never posted to the server.
- Session end is server-confirmed — never optimistically terminated locally. UI state for "session ended" follows the SSE event or a reconciliation snapshot.
- Reconnect recovery uses replay + snapshot reconciliation; **no polling refresh fallback** for emergency state.

### PWA / Service Worker (Phase 9)

- Build-tag versioning: `__VT_BUILD_TAG__` is injected at build time into both `public/sw.js` and the client bundle. The cache name (`vettrack-<buildTag>`) and the cross-tab split-version check use the same value.
- SW update flow: install precaches the shell and `self.skipWaiting()`; activate purges every non-current cache, claims clients, and posts `SW_UPDATED` with the new build tag.
- **Emergency endpoint cache bypass:** `/api/display/snapshot`, `/api/code-blue/sessions/active`, `/api/realtime/{stream,replay,outbox-head,telemetry}` are never read from or written to Cache Storage. The denylist is enforced on every fetch and any pre-existing entries are purged on activate.
- Stale-tab recovery: `main.tsx` catches `ChunkLoadError`/dynamic-import failures, clears SW caches, and force-reloads once (sessionStorage loop guard).

### Authority + enforcement (Phase 2.5 → Phase 5)

- Every clinical mutation passes through `resolveAuthority()` (`server/lib/authority.ts`). Authority resolves from `vt_clinical_check_ins` first; clinics that have not adopted the check-in path fall through to the shift-derived branch (**Strategy A safety net**) byte-for-byte equivalent to the pre-Phase-2.5 path. Strategy A is **not retired** — it is the load-bearing fallback for un-migrated clinics.
- Enforcement evaluators (`server/lib/authority/enforcement/*`) follow a uniform `off | shadow | enforce` mode per evaluator family (stale check-in, operational-role drift, Code Blue manager, task assignment, clinical-invariant orphan-dispense). Mode is resolved per-clinic with a short TTL.
- `off` skips the evaluator path entirely; `shadow` runs the evaluator but never denies — it emits bounded counters and a sampled audit row; `enforce` may deny with a stable reason code (e.g. `ORPHAN_DISPENSE_BLOCKED`, 422). All families are wired but ship `off` by default; rollout is per-clinic.
- **Frozen safety-valve doctrine:** resolver throws degrade to `off` at the wiring layer (CI-16/CI-20); `SMART_COP_VALIDATION_FAIL_OPEN=true` lets the evaluator degrade to allow when its own DB reads throw. Both paths emit a dedicated audit kind so dashboards separate observation from enforcement.
- Audit logging uses `logAudit()` from `server/lib/audit.ts` with a closed `AuditActionType` union; new audit kinds must be added to the union, not inferred.

### i18n governance (Phase 6)

- Two locales, Hebrew default: `locales/he.json`, `locales/en.json`. Parity is enforced by `scripts/i18n/check-parity.ts`.
- Frontend access goes through the typed accessor `t.*` (codegen'd into `src/lib/i18n.generated.d.ts`). User-facing copy lives only in JSON; hardcoded Hebrew in `.ts`/`.tsx` is rejected by `tests/i18n-no-hebrew-in-source.test.ts`.
- The `_meta.*` JSON namespace is for non-rendering metadata; runtime helpers strip it.
- Server-side error envelopes are i18n-rendered via `apiError()` (`server/lib/apiError.ts`); test routes have their own adoption tests.

### Operational doctrine (post-Phase-9)

- **Frozen surfaces:** SSE transport, build-tag versioning, the emergency endpoint denylist, the offline emergency-block doctrine, the enforcement `off|shadow|enforce` envelope, and the `appointmentsPage.*` i18n key namespace.
- **Telemetry cardinality is bounded.** New realtime / Code Blue / PWA observability fields are bounded enums routed through `POST /api/realtime/telemetry` and a closed `incrementMetric()` union. No raw IPs, user agents, durations, timestamps, or free-form labels.
- No offline emergency queueing, no transport replacement, no polling-based recovery for Code Blue, no optimistic local termination of emergency state.
- New evaluator wiring is additive: keep the legacy code path intact, gate on per-clinic mode, and document the audit/metric counters before rollout.
- Realtime / PWA work must be verified end-to-end in a real browser (the Playwright drills in `tests/phase-9-drills.spec.ts`); the deterministic unit harness (`tests/phase-9-deterministic-drills.test.ts`) covers the bounded-counter contracts.

---

## Deployment

Deployed via [Railway](https://railway.app) using Nixpacks. See `railway.json` and `nixpacks.toml`.

**Required production env vars** (validated at startup):
```
DATABASE_URL
REDIS_URL
SESSION_SECRET
CLERK_SECRET_KEY
VITE_CLERK_PUBLISHABLE_KEY
ALLOWED_ORIGIN
CLERK_WEBHOOK_SECRET
DB_CONFIG_ENCRYPTION_KEY
```

Full environment variable reference: `.env.example`

---

## Docs

- [Local dev sign-in runbook](docs/dev-signin-runbook.md)
- [Testing guide](docs/testing-guide.md)
- [Integrations guide](docs/integrations-guide.md)
- [Technical debt log](docs/technical-debt.md)
- [Migration history](docs/migrations.md)
- [Architecture decisions](docs/architecture/)

---

## Known Technical Debt

See [`docs/technical-debt.md`](docs/technical-debt.md) for the full log.

**Top items:**
- `vt_inventory_jobs` has no operator UI for failure visibility or manual retry
- Integration outbound sync (patient/appointment/billing push) is not yet batched via queue — only triggered per-record on demand
- `pdf-parse@1.1.4` is unmaintained since 2021 — no CVEs but should be replaced
