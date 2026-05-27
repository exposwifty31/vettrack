# VetTrack Pilot — Feature Reference

This document covers two related topics:

1. **Pilot readiness (mainline)** — operational hardening merged for hospital pilot go-live (integration gate, ops dashboard, Code Blue / realtime client fixes). See [Pilot readiness runbook](#pilot-readiness-runbook-mainline) below.
2. **Pilot v1 equipment mode** — compile-time equipment-only UI (`VITE_PILOT_MODE` / `PILOT_MODE`). Tag: **`pilot-v1`** (commit `0b40981`).

---

## Pilot readiness runbook (mainline)

Use this section when deploying or operating the **full** VetTrack stack for a clinic pilot (not equipment-only `PILOT_MODE`).

### Prerequisites

| Requirement | Notes |
|-------------|--------|
| Node.js ≥ 22.12, pnpm 9.15.9 | See `.nvmrc` |
| PostgreSQL 16 | `pnpm db:migrate` at startup and in CI |
| Redis | Required in production for BullMQ (inventory, notifications, job runtime cron workers) |
| Clerk (production) | `CLERK_SECRET_KEY` + `VITE_CLERK_PUBLISHABLE_KEY` + `ALLOWED_ORIGIN` |

### Minimal local dev (no Clerk)

Copy `.env.example` → `.env` and set at minimum:

```env
DATABASE_URL=postgres://vettrack:vettrack@localhost:5432/vettrack
SESSION_SECRET=dev-session-secret-for-local-development
NODE_ENV=development
```

Omit `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` to use **dev-bypass auth** (hardcoded admin, `clinicId = dev-clinic-default`). API routes work; the browser may show Clerk warnings unless keys are configured — see `docs/dev-signin-runbook.md`.

```bash
pnpm install
pnpm db:migrate
PORT=3001 pnpm dev    # API :3001, Vite :5000
```

### Verification commands (pre-deploy)

```bash
npx tsc --noEmit
pnpm test
pnpm test:integration:ops   # Postgres required; same job as CI "Integration ops"
```

CI merge gate also runs Playwright E2E shards on every PR.

### Operator surfaces (post-readiness merges)

| Surface | Route / API | Who | Purpose |
|---------|-------------|-----|---------|
| Ops dashboard | `/admin/ops-dashboard` | Admin | Outbox health, queue metrics, offline sync telemetry, **event outbox DLQ** (list / retry all / drop selected) |
| Code Blue | `/code-blue` | Clinical roles | Emergency session; mutations use `api.request()` and **fail loud offline** (never queued) |
| Ward / ER realtime | Display, ER command center | Staff | SSE `/api/realtime/stream` + HTTP replay catch-up on reconnect |
| Equipment ops gate | CI `integration-ops` | Engineering | `tests/equipment-operational-state.integration.test.ts` against Postgres 16 |

### Code Blue — operator expectations

- **Offline:** starting a session, logging entries, ending a session, or presence heartbeats **do not** queue for later sync. The UI shows an immediate error and records bounded telemetry only.
- **Session end:** navigation away from the active session happens only after the server accepts `PATCH …/end` (no optimistic local termination).
- **Ward display:** follows server snapshot + SSE keepalive; do not rely on stale `localStorage` (`vt_cb_cache` is cleared when the server reports no active session).

### Realtime — operator expectations

- Transport is **SSE only** (`/api/realtime/stream`), not WebSockets. Do not set `VITE_WS_URL` for new work.
- After long disconnects, clients paginate `GET /api/realtime/replay` to close gaps larger than the SSE reconnect batch.
- If the outbox cursor was pruned, clients receive `RESET_STATE` and resync ward/ER caches; cross-tab cursor `0` gossip is **clinic-scoped** (same origin, different clinic tabs do not force reset).

### Background jobs (JR-MIG wave 2)

When Redis is up, `startJobRuntime()` owns **expiry-check** and **stale-checkin-sweep** cron consumers (legacy `startExpiryCheckWorker` / `startStaleCheckInSweepWorker` are not called from `start-schedulers.ts`).

Optional: `STALE_CHECKIN_SWEEP_ENABLED=true` to register the stale clinical check-in sweep (default off).

### Multi-tenancy

Every clinic’s data is isolated by `clinicId` from auth middleware. Admin DLQ actions, procurement reads, and alert acknowledgements are clinic-scoped — operators only see their clinic’s rows.

### Frozen architecture (do not change without architecture review)

See `README.md` and `CLAUDE.md`: SSE/outbox replay, emergency SW denylist, Code Blue offline block list, bounded realtime telemetry, Strategy A authority safety net.

---

## Activation (pilot v1 equipment mode)

Pilot mode is a compile-time flag. Nothing is enabled without it.

| Surface | Variable | Value |
|---------|----------|-------|
| Frontend | `VITE_PILOT_MODE` | `"true"` |
| Backend | `PILOT_MODE` | `"true"` |

`src/lib/pilot-mode.ts` exports `isPilotMode` (`boolean`). Every pilot-specific branch in the frontend is guarded by this constant. The backend pilot guard in `server/app/routes.ts` gates pilot-only routes the same way.

---

## Features

### Day 5 — Admin pilot pulse

**Route:** `/admin` (existing page, new section)  
**Who sees it:** Admin only, pilot mode only

A "pilot pulse" strip at the top of the admin page showing four live counters:

- **Total** — total equipment items
- **Confirmed today** — items scanned with `status: "ok"` since midnight
- **Ever confirmed** — items with at least one lifetime confirmation
- **Never confirmed** — items with zero confirmations (red accent)

Counters are computed client-side from the existing equipment list query — no new endpoint. The strip remains hidden (zero-state suppressed) until the equipment list loads.

---

### Day 6 — Inline floor-note edit

**Route:** `/equipment/:id` (equipment detail page)  
**Who sees it:** All authenticated users, pilot mode only

A "Floor note" field in the equipment detail overview. Any authenticated user can tap the pencil icon to edit it inline and save. The note is stored in `vt_equipment.staffNote`. Changes are reflected immediately via optimistic update.

---

### Day 7 — Equipment detail, pilot-tuned

**Route:** `/equipment/:id`  
**Who sees it:** All authenticated users, pilot mode only

Equipment detail page improvements for the pilot context:

- `usuallyFoundHere` location hint displayed prominently below the equipment name
- Search alias chip shown when `searchAlias` is set
- Pilot-mode "Confirm here" quick-action replaces the standard checkout/return flow on the overview tab

---

### Day 8 — Admin scan log per item

**Route:** `GET /api/equipment/:id/logs` · `/equipment/:id` (Scan Log tab)  
**Who sees it:** Admin only (tab) — all authenticated (API, operational fields only)

A fourth tab "Scan Log" appears on the equipment detail page for admins in pilot mode. Features:

- **Date range filter**: Today / Last 7 days / All
- **Staff attribution**: each row shows the staff member's name and role (admin-only surface; non-admins receive the same endpoint with `staffName`/`staffRole` stripped server-side)
- **Status badge**: ok / issue / maintenance
- Paginated, newest first

**Attribution boundary (enforced server-side):**
- `GET /api/equipment/:id/logs` — returns `staffName`/`staffRole` only when `req.authUser.role === "admin"`
- `GET /api/rooms/:id/activity` — returns `userName` only when `req.authUser.role === "admin"`
- Retrieval surfaces (equipment list, room radar) never expose staff names

---

### Day 9 — Pilot coverage admin page

**Route:** `/admin/pilot-coverage`  
**Who sees it:** Admin only, pilot mode only

Dedicated page summarising how thoroughly the pilot has been adopted across the equipment inventory.

**Summary strip (4 cards):**

| Card | Meaning |
|------|---------|
| Total | All equipment items |
| Confirmed today | Scanned ok since midnight |
| Ever confirmed | ≥1 lifetime confirmation |
| Never confirmed | 0 confirmations (red) |

**Equipment list** sorted worst-first (never-confirmed items at top, then by oldest `lastSeen`). Each row shows:

- Name + staleness badge (Never / Stale / Recent)
- Usual location (`usuallyFoundHere` → `location` → folder name, in priority order)
- Time since last confirmation (relative)
- Lifetime confirmation count

Clicking a row navigates to the equipment detail page. A "Print QR" button in the header links to the QR print sheet.

**Backend:** `GET /api/equipment/pilot-coverage` (admin-only). LEFT JOINs `vt_scan_logs` for per-item counts and `vt_folders` for folder names. Applies the configurable `staleMs` threshold from `vt_server_config`.

---

### Day 10 — Room radar staleness + confirm

**Route:** `/room-radar`  
**Who sees it:** All authenticated users, pilot mode only (pilot UI branch)

In pilot mode the Room Radar card for each piece of equipment changes:

- **Quick action** becomes **"Confirm here"** (replaces checkout/return). Tapping it posts `status: "ok"` via the scan endpoint and invalidates the room radar query.
- **Staleness badge** below the equipment name:
  - `Never` (red) — no scan on record
  - `Stale` (amber + relative time) — last scan older than `staleMs`
  - `Recent` (green + relative time) — last scan within `staleMs`
- On confirm success a toast reads "Confirmed here".

The `staleMs` threshold is fetched live from `/api/pilot/config` for all authenticated users so badges are consistent across roles.

---

### Day 11 — QR print sheet, pilot-enhanced

**Route:** `/admin/equipment/print-qr`  
**Who sees it:** Admin only, pilot mode only

The existing QR print sheet gains pilot-specific enhancements:

- Items are **sorted never-confirmed first** (items with `lastSeen == null` sort to the top)
- A red **"Never"** badge appears on never-confirmed items
- A **"Select unconfirmed"** button selects all never-confirmed items in one click for bulk printing

The "Print QR" button in the pilot coverage page header links here.

---

### Day 12 — Configurable staleness threshold

**Endpoint:** `GET /api/pilot/config` · `PATCH /api/pilot/config`  
**Who can write:** Admin only  
**Who can read:** All authenticated users (threshold needed for UI display)

The staleness threshold (`staleMs`) is stored in `vt_server_config` under key `pilot_stale_ms`. Default: **86 400 000 ms (24 h)**.

| Constraint | Value |
|---|---|
| Minimum | 1 hour (3 600 000 ms) |
| Maximum | 7 days (604 800 000 ms) |

**Admin UI:** An inline settings card below the pilot pulse strip on the admin page. Click the pencil icon, enter the threshold in hours (1–168), and save. The input converts hours to milliseconds before calling `PATCH /api/pilot/config`. On success the React Query cache is updated and all pilot badges reflect the new threshold immediately.

**Frontend hook:** `usePilotStaleMs()` in `src/hooks/use-pilot-config.ts`. Fetches live config for all authenticated users in pilot mode; falls back to `PILOT_STALE_MS_DEFAULT` (24 h) if the request fails or is not yet resolved.

**Audit:** Every PATCH logs a `pilot_config_updated` entry via `logAudit()`.

---

### Day 13 — Attribution audit + hardening

No user-visible changes. Server-side enforcement of the attribution boundary.

**Changes:**

- `GET /api/equipment/:id/logs` — `staffName`/`staffRole` stripped from response for non-admin callers (was: returned to all authenticated users; UI tab was already admin-only)
- `GET /api/rooms/:id/activity` — `userName` stripped from response for non-admin callers
- `tests/attribution-boundary.test.ts` — 9 unit tests covering both endpoints

**Surfaces audited and left unchanged (intentional pre-existing design):**

| Surface | Field | Rationale |
|---|---|---|
| `GET /api/activity` | `userDisplayName` | Explicit transparency feed for all staff; commented intent in source |
| Equipment list/detail | `lastVerifiedByName` | Operational context, pre-pilot, outside scope |
| Appointments, Code Blue, Patients | Various | Clinical operational data appropriate to those surfaces |

---

## Database

No new tables. Pilot features use:

- `vt_equipment.staffNote` — floor note (Day 6)
- `vt_equipment.usuallyFoundHere`, `searchAlias` — location hint + alias (Day 7)
- `vt_scan_logs` — confirmation records (all days)
- `vt_server_config` key `pilot_stale_ms` — configurable threshold (Day 12)

---

## Turning pilot mode off

1. In Railway (or host env): **unset** `PILOT_MODE` and `VITE_PILOT_MODE`, or set both to `"false"`.
2. **Redeploy with a fresh frontend build** — `VITE_*` is compile-time; changing env without `pnpm build` leaves pilot UI baked in.
3. Verify: `curl -sS https://<host>/api/version` → `pilotMode.backend` and `pilotMode.frontend` must be `false`.

Mainline `railway.json` / `nixpacks.toml` builds force `VITE_PILOT_MODE=false`. Production startup **fails** if `PILOT_MODE=true` without `ALLOW_EQUIPMENT_PILOT_MODE=true`.

---

## Known limitations (v1)

- `GET /api/pilot/config` has no cache-invalidation push — if an admin changes the threshold, other tabs refresh on the 5-minute `staleTime` window rather than instantly.
- The pilot coverage page does not auto-refresh; operators should reload to see the latest counts during active scanning sessions.
- QR print sheet pilot sort is client-side only (sorts the already-fetched equipment list).
