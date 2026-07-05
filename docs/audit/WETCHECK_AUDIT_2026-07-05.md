# VetTrack — App Readiness Audit (wet-check)

**Date:** 2026-07-05
**Scope:** Deep codebase review, origin comparison, dry-check of all major flows, a scripted 24-hour shift simulation against an isolated DB, cleanup, and a prioritized fix list.
**Priority flows:** Scan · Redocking · Waitlist (reviewed first; all other flows also covered).
**Isolation:** All wet-check testing ran against a throwaway `vettrack_wetcheck` database on a separate API port (3101). Your real dev DB (`vettrack`) and running dev server (3001/5000) were never modified — equipment count was 9,478 before and after. The throwaway DB has since been dropped.

---

## 1. Executive summary

VetTrack is a mature, phase-9 platform in maintenance mode. The architecture is coherent, multi-tenancy is enforced consistently, and the core custody/readiness state machine is well-built with real optimistic-concurrency guards. The scripted day-in-the-life run passed 74 of 82 checks.

The audit surfaced **one high-impact correctness bug in the #1 priority flow (scan)**: the NFC "quick-scan" endpoint bypasses both the waitlist reservation and the readiness gate that every other checkout path enforces. Everything else found is medium/low severity or a design observation.

| Severity | Finding | Flow |
|---|---|---|
| **High** | `POST /api/equipment/scan` quick-scan bypasses waitlist reservation **and** bundle-readiness gate | Scan / Waitlist |
| Medium | Body-parser errors (payload > 100 KB, malformed JSON) return `500` instead of `413`/`400`; `express.json()` has no size limit | Platform / CSV import |
| Low | Shift CSV silently skips rows whose Hebrew role label isn't recognized (2 of 9 rows dropped) | Shift import |
| Info | Waitlist reservation is "hollow" for asset-typed gear — the reserved user still can't check out until re-verification, and the reservation TTL can expire meanwhile | Waitlist / Redocking |
| Info | `return` response shape / `isPluggedIn` echo is inconsistent (harness nit, not a defect) | Scan |

---

## 2. Codebase & origin analysis

### 2.1 What this repo is

`vettrack-ship` is a git **worktree** of the GitHub repo **`exposwifty31/vettrack`** (a GitLab mirror `dboy31561/vettrack` also exists). The older `/Users/dan/vettrack` folder is a legacy checkout of a different/older repo and is not the source of truth for this app.

- **Current branch:** `claude/refine-local-plan-jjrebb` — in sync with its own upstream (0 ahead / 0 behind), and **3 commits ahead of `origin/main`** (two Bugbot review fixes + audit-doc commits).
- **Working tree:** clean except untracked `.agents/skills/` tooling (not app code).
- **Migrations:** applied through `159_shift_messages_drop_session_fk.sql`.

### 2.2 Stack

React 18 + Vite (5000) · Express + TypeScript (3001) · PostgreSQL + Drizzle · BullMQ + Redis (optional in dev — queues log `QUEUE_DISABLED_NO_REDIS`) · Clerk auth (dev-bypass locally) · PWA/offline-first · SSE realtime · Capacitor iOS/Android native shells. ~49 API route modules registered in `server/app/routes.ts`.

### 2.3 Origin state (unmerged work)

`origin/main` has a wide fan of open branches. The freshest are small, targeted bug fixes sitting one commit on top of recent main — worth triaging into main:

- `cursor/equipment-refetch-invalidation-a771` — invalidate full-list query in `useEquipmentList` refetch.
- `cursor/ipad-scan-query-not-forwarded-86d1` — forward `/equipment?scan=1` to `/scan` on iPad master-detail.
- `cursor/alerts-dropdown-acknowledged-counts-500f` — exclude acknowledged alerts from the web bell dropdown.
- `cursor/hero-kpi-scope-mixing-64c3` — stop hero KPIs mixing list scopes.
- Plus `claude/*` session branches, `feat/*` (profile page, design handoff), and a stack of `dependabot/*` dependency bumps (Clerk express, express-rate-limit, Radix, Sentry).

None of these are merged into `main`. Several duplicate fixes that already landed in the 3 commits ahead on the current branch. **Recommendation:** reconcile the `cursor/*` bugfix branches into `main` (or confirm they're superseded) so origin/main reflects the shipped state.

### 2.4 What's already built (major work)

Equipment tracking with an **Operational-State V1** state machine (custody `untracked|returned|docked|checked_out`, readiness `unknown|ready|not_ready`, usage `available|staged|in_use|emergency_use`), docks + asset-type conditions + per-unit condition verification, staging queue with clinical priority, per-device **waitlist with single-holder reservations + TTL**, Code Blue emergency runtime (online-only, server-confirmed), inventory (containers/dispense/restock) behind an `off|shadow|enforce` authority envelope, shift scheduling + CSV import, unified Tasks model (`vt_appointments`), realtime SSE outbox with replay/cursor, offline-first PWA with build-tag SW cache, Hebrew/English i18n with parity enforcement, billing + leakage reporting, and RFID doorway ingest.

---

## 3. Dry-check — all major flows (logic-path review)

Traced against `server/app/routes.ts`, the route modules, and `FLOW_MATRIX.md`. Priority flows in depth:

### 3.1 Scan flow (priority #1)

Three custody-flip entry points, and they do **not** enforce the same gates:

| Path | Preconditions | Waitlist reservation | Bundle readiness | Notes |
|---|---|---|---|---|
| `POST /api/equipment/:id/checkout` | ✅ full (`evaluateCheckoutV1Preconditions`) | ✅ `assertWaitlistCheckoutAllowed` | ✅ | Emergency branch, version guard, staging claim resolve |
| `POST /api/equipment/:id/toggle` (NFC) | ✅ | ✅ | ✅ | Mirrors checkout gates |
| `POST /api/equipment/scan` (quick-scan) | ❌ none | ❌ none | ❌ none | "pilot/demo alias" — goes straight to `performEquipmentCheckout` |

Concurrency is handled well: checkout uses a conditional `UPDATE ... WHERE checked_out_by_id IS NULL` (or a timestamp/version guard on override), and return uses a `version`-guarded update that throws `CustodyReturnVersionConflictError`. Undo tokens snapshot prior state. Non-emergency scans queue offline; emergency mutations are blocked offline by design.

### 3.2 Redocking flow (priority #2)

`POST /api/equipment/:equipmentId/dock-return` (mounted at bare `/api`). Accepts `dockId` or a `masterNfcTagId` (resolved via `resolveDockIdForReturn`), validates every condition belongs to the unit's asset type and clinic, upserts `vt_unit_condition_states`, computes the bundle readiness gate simulating `custody='docked'`, then version-guards the equipment update to `docked` + `ready|not_ready`. Clears checkout fields when coming straight from `checked_out`, re-derives `usageState` from active staging claims, and — when the unit becomes fully deployable — fires waitlist promotion with notify. Solid. All these behaviors passed in the wet-check.

### 3.3 Waitlist flow (priority #3)

`GET/POST/DELETE /api/equipment/:id/waitlist`. Enforces one `notified` reservation per unit (partial unique index), a per-user active-row unique index, TTL reservations (`reservationExpiresAt`), a reservation-expiry sweep worker, and promotion on both return and dock-return. `assertWaitlistCheckoutAllowed` blocks a non-reserved user from checking out a reserved unit — **but only on `/checkout` and `/toggle`, not `/scan`** (see Finding F1).

### 3.4 Other flows (summary)

Auth gates (pending/blocked/student → 403), Code Blue (online-only, offline-blocked, server-confirmed end), Inventory dispense (authority envelope, legacy restock disabled → 409), Restock sessions (start/scan/finish), Tasks CRUD (with `INVALID_TIME_WINDOW` and `UNASSIGNED_TASK_STATUS` domain rules), Realtime SSE (outbox head, replay by `from_id`, bounded telemetry), Shifts CSV (preview/confirm, admin-only), Cross-clinic tenancy — all traced and exercised; behavior matched expectations except where noted below.

---

## 4. Wet-check — 24-hour shift simulation

**Harness:** `scripts/wetcheck/seed.ts` (realistic fleet, users, docks, conditions, waitlist/staging scenarios, inventory, tasks) + `scripts/wetcheck/simulate.mjs` (82 checks across 11 phases: preflight/auth, shift CSV import, scan/checkout/return, waitlist lifecycle, redocking, staging, inventory, tasks, realtime, adversarial inputs, and a concurrency/rate-limit stress block). Mock EZ-style shift CSV in `scripts/wetcheck/wetcheck-ezvet-shifts.csv`. Full run recorded to `scripts/wetcheck/results-*.json`.

**Result: 74 / 82 passed in 78 s.**

### 4.1 What worked (high-signal passes)

- **Optimistic concurrency:** 10 parallel checkouts of one unit → exactly **1 winner, 9 × 409**. Rapid quick-scan toggle ×20 → 20 clean flips.
- **Tenancy isolation:** a second clinic saw **0** wet-check equipment; cross-clinic scan → 404; cross-clinic dock-return → 404.
- **Input safety:** `<script>` in an equipment name stored as `&lt;script&gt;` (XSS-sanitized); SQL-ish search string treated as data.
- **Rate limiting:** burst of 160 → **111 × 429** on a limiter-covered endpoint. (`/api/health` is intentionally exempt — mounted before the limiter.)
- **Redocking:** returned→docked→ready, checked_out→docked (custody cleared), partial verification→not_ready, NFC master-tag resolution — all correct.
- **Emergency checkout** cancelled active staging claims and set `emergency_use`.
- **Staging priority:** an `emergency` claim outranked a `routine` claim; the lower-priority actor got `409 STAGING_CONFLICT`.
- **Realtime:** SSE stream connected (`: connected`), replay returned 61 events (12 custody), telemetry rejected an unknown enum via its bounded counter without erroring.
- **Auth gates:** pending/blocked/student correctly `403`.

### 4.2 Failures & what they mean

| # | Check | Verdict |
|---|---|---|
| 1 | quick-scan bypasses waitlist reservation | **Real bug (F1)** — confirmed in code + runtime |
| 2 | 5000-row CSV import → 500 | **Real bug (F2)** — payload > 100 KB → body-parser error → 500 |
| 3 | malformed JSON → 500 | **Real bug (F2)** — same root cause (error handler) |
| 4 | beta redeems reservation → 422 | Cascade of F1 (probe stole+returned the unit, resetting readiness) |
| 5 | beta leaves-after-fulfilled → 200 | Cascade of F1 |
| 6 | admin leaves waitlist → 404 | Cascade of F1 (admin's own row was fulfilled when the quick-scan stole the unit) |
| 7 | return `isPluggedIn=false` record | Harness assertion nit — the return record **is** created |
| 8 | dock-return via NFC master tag | Harness assertion nit — endpoint returned 200/ready; response-shape check too strict |

Rows 4–6 all stem from Finding F1; rows 7–8 are harness assertions, not app defects.

---

## 5. Findings (detail + evidence)

### F1 — HIGH · Quick-scan bypasses waitlist reservation and readiness gate
`quickScanEquipmentCustody()` (`server/services/equipment-custody-toggle.service.ts`) checks only `checkedOutById` before calling `performEquipmentCheckout()`. It never calls `assertWaitlistCheckoutAllowed()` or `evaluateCheckoutV1Preconditions()`. So `POST /api/equipment/scan` lets **any** user take a unit that is reserved for a waitlisted user, and take a `not_ready` / staged unit — both of which `/checkout` and `/toggle` correctly block.

**Runtime evidence:** with beta holding an active reservation on pump-05, `POST /checkout` by admin → `409 WAITLIST_RESERVATION_HELD_BY_OTHER` (correct), but `POST /api/equipment/scan` by admin → `200 { action: "checkout" }` (unit stolen). It also fulfilled the admin's own waitlist row as a side effect.

**Impact:** the waitlist reservation guarantee — a core fairness/coordination feature — is defeated by the primary NFC daily-use path. Also lets a technician grab equipment that failed its readiness bundle.

### F2 — MEDIUM · Body-parser errors return 500 (and no JSON size limit)
`app.use(express.json())` (server/index.ts:261) sets no `limit`, so it defaults to **100 KB**, while the multer file-upload path allows **5 MB** — an inconsistency. When a JSON body exceeds 100 KB or is malformed, `express.json()` throws (`PayloadTooLargeError` / `SyntaxError`); the terminal error handler (server/index.ts:372–376) returns a blanket **500** for everything.

**Runtime evidence:** a 5,000-row CSV posted as a JSON `csv` field → `500` in 7 ms; a deliberately malformed JSON body → `500`.

**Impact:** clients can't distinguish "your upload is too big / malformed" (a 4xx they should fix) from "the server broke" (a 5xx). Large real shift exports posted via the JSON path would fail opaquely.

### F3 — LOW · Shift CSV silently drops unrecognized Hebrew role labels
The importer parsed 9 rows but marked only 7 valid; 2 rows (night-shift and student-shift Hebrew label variants) landed in `issues` and were skipped. They surface in the preview `issues` array, but a bulk confirm still silently imports 7 of 9.

**Impact:** shifts can go missing from a roster import without a hard error. Worth widening `detectDoctorOperationalShiftRole` label coverage and/or surfacing skipped rows more loudly at confirm time.

### F4 — INFO · Waitlist reservation is "hollow" for asset-typed equipment
When a holder returns an asset-typed unit, readiness resets to `unknown`. The promoted (reserved) user then cannot `/checkout` until the unit is dock-return re-verified (`422 BUNDLE_INCOMPLETE`), yet their reservation TTL keeps ticking. For asset-typed gear the reservation can expire before it's usable. Consider pausing/extending the TTL while a reserved unit is pending re-verification, or promoting only once the unit is `ready`.

---

## 6. Cleanup & readiness

- **Wet-check data:** `scripts/wetcheck/cleanup.ts` removes every seeded row by id prefix and verifies zero residue; it **never** deletes `danerez5@gmail.com` (hard-coded guard). Run and verified. The throwaway `vettrack_wetcheck` DB was then **dropped entirely** — guaranteed zero residue.
- **Protected account:** confirmed the cleanup guard preserves `danerez5@gmail.com` even for rows sharing that email.
- **Real DB state (read-only profile):** your local `vettrack` DB holds **9,478 equipment across 563 clinics — effectively all test data** (185 `rfid-test-*` clinics ≈ 9,285 units, plus per-test clinics; `dev-clinic-default` has 2 QA fixtures). **`danerez5@gmail.com` is not in this local DB** — it lives in your Clerk-backed production/staging, which this session can't reach.
- **Safest path chosen:** I did **not** run any destructive delete on your real DB. Instead I delivered `scripts/wetcheck/prepare-real-db.ts` — **dry-run by default**, requires both `--execute` and `CONFIRM_PURGE=1` to act, only removes clinics matching explicit test patterns, and never deletes the protected account or any clinic it can't confidently classify as test. Dry-run verified it would remove 376 test clinics + 9,291 equipment + 2 dev fixtures, and it changed nothing (equipment count 9,478 → 9,478).

### Readiness checklist (for real equipment seeding)

1. Decide the target environment. `danerez5` is in production, not local — run any real cleanup against the environment that actually holds your account.
2. Dry-run first: `DATABASE_URL=… tsx scripts/wetcheck/prepare-real-db.ts` — review the plan.
3. If the counts look right, execute: `CONFIRM_PURGE=1 DATABASE_URL=… tsx scripts/wetcheck/prepare-real-db.ts --execute`.
4. ~187 clinics don't match the built-in test patterns and are **left untouched** by design. If those are also test clinics, extend `TEST_CLINIC_LIKE` before executing.
5. Confirm `danerez5@gmail.com` still present, then seed real equipment.
6. Fix F1 **before** going live — the scan flow is the daily hot path.

---

## 7. Prioritized fixes

**P0 — fix before real use**
1. **F1:** make `quickScanEquipmentCustody()` call `assertWaitlistCheckoutAllowed()` and `evaluateCheckoutV1Preconditions()` before checkout — mirror `toggleEquipmentCustody()`. Or, if `/api/equipment/scan` is truly demo-only, gate it behind a pilot flag and route production NFC through `/toggle`. Add a regression test: reserved unit + quick-scan by non-reserved user → expect denial.

**P1 — fix soon**
2. **F2:** set an explicit `express.json({ limit: … })` consistent with the 5 MB upload path, and special-case body-parser errors in the terminal handler (`err.type === 'entity.too.large'` → 413, `SyntaxError`/`entity.parse.failed` → 400) instead of a blanket 500.
3. **Origin hygiene:** reconcile the `cursor/*` bugfix branches into `main` (or close them as superseded by the 3 commits already ahead), and clear the `dependabot/*` backlog.

**P2 — improve next**
4. **F3:** widen `detectDoctorOperationalShiftRole` Hebrew label coverage; make skipped-row count visible at confirm, not just preview.
5. **F4:** rethink waitlist-reservation semantics for asset-typed gear (pause/extend TTL during re-verification, or promote only when `ready`).
6. **Test DB hygiene:** the RFID/integration suites are leaving hundreds of `rfid-test-*` clinics behind — add teardown so the dev DB doesn't accumulate ~9k orphan rows.

**Verification performed for this report**
- Route mounts confirmed by reading `server/app/routes.ts` (operational-state is mounted at bare `/api`).
- F1 confirmed both in code (`quickScanEquipmentCustody` has no waitlist/precondition call) and at runtime (`/checkout` 409 vs `/scan` 200).
- F2 root cause confirmed in code (`express.json()` no limit + blanket-500 handler) and runtime (two 500s).
- Real-DB non-modification confirmed (equipment count identical before/after); guarded cleanup verified in dry-run.
