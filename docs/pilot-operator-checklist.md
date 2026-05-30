# VetTrack pilot — operator checklist

**Audience:** Clinic admin, charge nurse, engineering on-call  
**Stack:** Mainline full VetTrack (not equipment-only `PILOT_MODE`)  
**Canonical reference:** `docs/pilot.md` (mainline runbook)  
**Verification authority:** **CI on `main` is authoritative.** Local dev may skip integration tests or use dev-bypass auth; staging/production behavior follows deployed `main` + environment config.

---

## Pre-shift checklist

### Infrastructure (engineering / admin — before first clinical shift)

- [ ] Deploy commit matches approved `main` tip (see `docs/pilot-go-no-go-report.md` PR timeline).
- [ ] PostgreSQL 16 reachable; application startup applied migrations (`pnpm db:migrate` or automatic at boot).
- [ ] **Redis** running in production (BullMQ: inventory, notifications, expiry-check, stale-checkin when enabled).
- [ ] Clerk: `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `ALLOWED_ORIGIN` set for clinic origin.
- [ ] Confirm last deploy **CI merge gate was green** (do not rely on a developer laptop-only test run).

### Admin — ops dashboard (`/admin/ops-dashboard`)

- [ ] Sign in as **admin** for the pilot clinic.
- [ ] Outbox health: no sustained publish backlog (see dashboard metrics).
- [ ] **Event outbox DLQ:** zero rows, or each row reviewed (see [DLQ handling](#dlq-handling)).
- [ ] Offline sync telemetry: circuit not stuck open; no unexplained spike in permanent failures.

### Clinical surfaces — smoke

- [ ] Ward **display** loads snapshot; no blank screen after refresh.
- [ ] **ER command center** loads board (if used in pilot).
- [ ] **Tasks** (appointments page) list loads for today.
- [ ] Equipment scan/checkout path tested once with a non-patient asset (if in scope).

### Code Blue — readiness

- [ ] Confirm device is **online** before any drill (offline mutations are **blocked by design**).
- [ ] `/code-blue` accessible to authorized roles.
- [ ] Ward display shows correct active session state after a test start/end (if drill approved).

---

## During-shift monitoring

| Signal | Where | Action |
|--------|-------|--------|
| Outbox DLQ growth | Ops dashboard → DLQ panel | Triage within 15 min; retry or drop per policy below |
| Sync failures | Ops dashboard → offline telemetry | If circuit open, check network; do not bulk-delete pending sync without review |
| Realtime stale UI | Ward / ER tabs | Hard refresh once; if persists, check SSE (browser network: `/api/realtime/stream` connected) |
| Inventory vs billing skew | Inventory jobs UI (`/billing/inventory-jobs`) | Expected briefly after med task complete; wait 10 min recovery sweep; see `docs/runbooks/inventory-jobs-failed-deductions.md` for failed rows |
| Code Blue | Display + session page | Server is source of truth; do not trust local-only "ended" state |

**Do not** enable WebSocket URLs (`VITE_WS_URL`) — realtime is **SSE only**.

---

## DLQ handling

**Location:** `/admin/ops-dashboard` → Event outbox DLQ (clinic-scoped).

| Action | When to use |
|--------|-------------|
| **Retry all** | Transient downstream failure cleared; events safe to republish |
| **Drop selected** | Poison message confirmed; clinical/financial impact reviewed and documented |
| **List review** | Every shift start and shift end |

**Rules:**

- DLQ rows are **per clinic** — admins only see their tenant.
- Dropping events may mean **lost realtime fan-out** for that id; confirm ward/ER caches resynced after drop.
- Escalate to engineering if DLQ grows faster than retry can drain.

---

## Code Blue behavior

| Scenario | Expected behavior |
|----------|-------------------|
| Start session | Online only; uses `api.codeBlue.sessions.start` |
| Log entry | Online only; optimistic UI rolls back on failure |
| End session | **Server confirms** end before UI navigates away |
| Offline attempt | Immediate error toast; **not** queued for later sync |
| Ward display | Follows SSE + snapshot; `vt_cb_cache` cleared when server reports no active session |
| Multi-tab | Cursor gossip is **clinic-scoped**; other clinics on same browser profile do not force reset |

**Never** train staff to "work around" offline Code Blue by refreshing — mutations must succeed online or use hospital fallback protocol outside VetTrack.

---

## Offline workflow expectations

| Area | Behavior |
|------|----------|
| Equipment / tasks / routine API | May queue in Dexie `pendingSync`; sync engine retries with circuit breaker |
| Code Blue | **Never queued** — blocked in API client |
| Emergency realtime endpoints | **Not cached** by service worker (denylist) |
| Multi-tab sync | `navigator.locks` serializes queue processing where supported |
| Permanent failure | Item marked failed; check ops telemetry (toast UX may be limited — see `BUG_REGISTER.md` EU-01) |

Staff should use **Sync status** UI (where exposed) after connectivity returns; admin monitors ops dashboard.

---

## Escalation path

| Severity | Contact | Examples |
|----------|---------|----------|
| **P0 — patient safety / wrong clinic data** | Clinical lead + engineering on-call immediately | Suspected cross-clinic data, wrong med task on wrong animal |
| **P1 — feature down** | Engineering on-call | Cannot sign in, API 5xx, Redis down, migration failed on deploy |
| **P2 — degraded** | Engineering next business day | DLQ slow drain, UTC task boundary confusion, ER queue API 501 |
| **Ops / keys** | Platform admin | Clerk, Railway, rotation (`docs/runbooks/1.4-clerk-key-rotation.md`) |

**Forensics:** Preserve audit logs; do not mass-drop DLQ before engineering snapshot.

---

## End-of-shift validation

- [ ] **DLQ:** Empty or all rows actioned (retry/drop) with note in shift log.
- [ ] **Code Blue:** No active session in display snapshot; session ended on server.
- [ ] **Sync queue:** No large backlog of `pending` items (admin telemetry).
- [ ] **Open equipment:** Returns completed or handed off per protocol.
- [ ] **Incidents:** Any offline Code Blue blocks or sync permanent failures logged for engineering.

---

## Quick reference — routes

| Surface | Route |
|---------|-------|
| Ops dashboard | `/admin/ops-dashboard` |
| Code Blue | `/code-blue` |
| Ward display | `/display` |
| Tasks | `/appointments` |
| ER command center | `/er` (if enabled) |

---

## Related documents

- `docs/pilot.md` — prerequisites, verification commands, frozen surfaces
- `docs/pilot-go-no-go-report.md` — Go/No-Go decision and rollback
- `docs/pilot-step8-debug-pass.md` — technical verification matrix
- `BUG_REGISTER.md` — non-blocking backlog
