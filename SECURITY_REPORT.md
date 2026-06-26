# VetTrack — Forensic Security & Architecture Verification Audit

**Date:** 2026-06-26
**Scope:** Authentication · Authorization · Multi-tenant isolation · Database · Workers · State · Tests
**Method:** Evidence-based code-path verification. Every finding cites exact file, line, and code path. No speculation. Where a path was sampled rather than exhaustively swept, it is labeled INSUFFICIENT EVIDENCE rather than asserted.

**Classification legend**

| Tag | Meaning |
|-----|---------|
| `CONFIRMED ✅` | Property verified secure against the cited code path |
| `CONFIRMED ⚠️` | A real weakness verified against the cited code path |
| `NOT CONFIRMED` | A plausible vulnerability hypothesis tested and **disproven** by the code |
| `INSUFFICIENT EVIDENCE` | Could not be exhaustively verified within audit scope |

**Coverage note.** Server is ~309 files. This audit read the auth/authority core in full and *sampled* the highest-risk data paths (dispense, procurement, inventory, equipment, users, containers, code-blue, outbox, workers, webhooks). Findings about *universality* ("every query", "all routes") are supported by sampling + existing structural tests, and are explicitly scoped as such in §3.

---

## 1. Confirmed Findings

### 1.1 Authentication

#### A1 — Single source of identity truth (server-side) · `CONFIRMED ✅`
In production (`clerk` mode), identity is resolved exclusively from the Clerk session and the database user row. There is no second identity source.

- `server/lib/clerk-session-auth.ts:14-24` — `readClerkUserSession()` is the sole session reader (`getAuth(req, { acceptsToken: "any" })`, then narrows on `userId`).
- `server/middleware/auth.ts:402-422` — the user row is upserted; **role is read from `vt_users.role`** (`normalizeUserRole(user.role)`, line 484), never from JWT claims. Session claims supply only `email`/`name`/`locale` (`auth.ts:367-372`).
- The `onConflictDoUpdate` set-clause at `auth.ts:414-421` **deliberately excludes `role`**, so a mid-session DB downgrade is honored on the next request (comment at `auth.ts:398-401`).

**Answer — "exactly one source of identity truth?"** Yes, server-side. Role is DB-authoritative; the IdP cannot assert role.

#### A2 — Production cannot start in dev-bypass · `CONFIRMED ✅`
- `server/middleware/auth.ts:138-140` — module-load guard throws `CLERK_SECRET_KEY is required in production` if `NODE_ENV=production && !CLERK_SECRET_KEY`.
- `server/middleware/auth.ts:255` — the dev-bypass branch is gated on `isDevelopment && resolveAuthModeFromEnv().mode === "dev-bypass"`. Dev override headers (`x-dev-role-override`, `x-dev-user-id-override`, `x-dev-clinic-id-override`, `auth.ts:258-267`) are unreachable in production.
- Mode precedence is deterministic and shared client/server: `server/lib/auth-mode.ts:38-51` (`clerk-explicitly-disabled` → `secret-present` → `secret-missing`).

#### A3 — Legacy/override auth paths exist but are gated · `CONFIRMED ⚠️ (by design, low risk)`
Two non-Clerk paths grant elevated identity:

1. **Stability-token admin bypass** — `server/middleware/auth.ts:241-253`. A request carrying `x-stability-token === STABILITY_TOKEN` resolves to `{ ...DEV_USER, role: "admin" }`. In production this is **restricted to loopback** remote addresses (`LOOPBACK_ADDRS`, `auth.ts:238,243-251`); external origin → 403. Token source: `server/lib/stability-token.ts:2-3` — `process.env.STABILITY_TOKEN` or a random-per-process 32-byte hex (unguessable if unset).
2. **Dev override headers** — dev-only (gated as in A2).

**Exploitability:** In production, the stability bypass requires both knowledge of `STABILITY_TOKEN` **and** a loopback origin (SSRF-adjacent only). Not remotely exploitable as written. **Business impact:** Internal health/stability tooling reaches admin context on the box; acceptable given the loopback gate, but the bypass is a standing high-value target — `STABILITY_TOKEN` must be treated as a production secret.

#### A4 — Environment-driven admin grant (`isAdminEmail`) · `CONFIRMED ⚠️ (by design)`
- `server/lib/admin-email-allowlist.ts:22-25` — `isAdminEmail()` matches `email` against the comma-separated `ADMIN_EMAILS` env list (normalized lower-case).
- `server/middleware/auth.ts:389-391` — a **new** Clerk user whose email is in the allowlist is bootstrapped with `role: "admin", status: "active"`.
- Because the conflict path excludes `role` (A1), the allowlist affects **first-login defaults only** — it does **not** retroactively elevate an existing non-admin user.

**Exploitability:** Requires the attacker to register, at the IdP, an email that operations placed in `ADMIN_EMAILS`. Not client-controllable. **Business impact:** `ADMIN_EMAILS` is a privileged config surface; a stale/typo'd entry that an outsider can register at Clerk would self-elevate on first login.

---

### 1.2 Authorization

#### B1 — Two coexisting authorization stacks, single clinical resolver · `CONFIRMED ✅`
Authorization is **layered, not duplicated**:

- **Legacy/system stack** — `server/middleware/auth.ts`: `requireAuth`, `requireAdmin` (483→`auth.ts:671-701`), `requireClinicalUser` (`704-722`), `requireEffectiveRole` (`724-791`), `ROLE_HIERARCHY` (`43-52`). Role math via `resolveCurrentRole()` (`server/lib/role-resolution.ts:59-170`).
- **Clinical authority stack** — `server/lib/authority.ts:127-370` (`resolveAuthority`) consumed by the single middleware `server/middleware/authority.ts:98-239` (`requireClinicalAuthority`). The middleware does **not** re-implement shift logic; it calls the one resolver (`authority.ts` docblock `:3-7`).

**Answer — "centralized? duplicated?"** Centralized per concern; the clinical path has exactly one resolver. The two stacks are intentional and documented (`authority.ts` middleware docblock `:8-22`).

#### B2 — Admin-bypass semantics are explicit and differ per stack · `CONFIRMED ✅`
- `requireEffectiveRole` — identity admin (or `secondaryRole === "admin"`) **always** short-circuits: `server/middleware/auth.ts:758-760`.
- `requireClinicalAuthority` — identity admin bypasses **only** when `opts.allowSystemAdmin === true`: `server/middleware/authority.ts:170-173`. Otherwise admin identity gets no clinical authority unless a shift/check-in grants it.
- `secondaryRole` is never consulted by the clinical resolver (passed `null`, `authority.ts:294-295`; middleware `authority.ts:147`).

#### B3 — Student hard-stop and shift-role ceiling · `CONFIRMED ✅`
- `server/lib/authority.ts:137-147` — `clinicalRole === "student"` returns `effectiveClinicalRole: null` **before** any shift/check-in lookup.
- `shared/authority.ts:33-43` — `ActiveShiftRole`/`EffectiveClinicalRole` exclude `"admin"` and `"student"` at the **type level**, so the never-elevate rule is compiler-enforced.

#### B4 — Enforcement envelope (`off | shadow | enforce`) with fail-safe degradation · `CONFIRMED ✅`
- `server/lib/authority.ts:238-271` — stale/oprole evaluators run only inside the check-in branch; a `deny` returns a denial snapshot with a single stable reason (`CHECKED_IN_STALE` / `CHECKED_IN_OPROLE_REVOKED`).
- **Strategy-A safety net:** resolver throws degrade to a safe snapshot rather than crashing the request (`authority.ts:162-172, 300-310`); the dispense wiring degrades evaluator-resolution throw to `off` (`server/services/dispense.service.ts:338-344`).
- Middleware narrows the `try` to the resolver call only, so audit/record errors cannot re-enter the 500 path (`server/middleware/authority.ts:132-165`).

**Answer — "privilege escalation / bypass demonstrable?"** Not against the sampled paths. The student type-ceiling, the DB-authoritative role, and the explicit admin-bypass flags close the obvious escalation vectors. No bypass was demonstrable.

---

### 1.3 Multi-Tenant Isolation

#### C1 — Isolation is 100% application-enforced; no DB backstop · `CONFIRMED ⚠️ (architectural)`
There is **no PostgreSQL Row-Level Security, no `current_setting`/`set_config` session-GUC tenant scoping, and no `CREATE POLICY`** anywhere in `server/` or `migrations/` (verified by negative search). Every tenant boundary is a hand-written `clinicId` predicate.

**Business impact:** A single omitted `clinicId` predicate is a cross-tenant exposure with no second line of defense. This raises the blast radius of any future query-level mistake. The team mitigates this with discipline + targeted structural tests (C3) rather than a database guarantee.

#### C2 — Tenant discipline is consistently applied on sampled high-risk paths · `CONFIRMED ✅`
Representative verified paths pair `clinicId` with the resource id on **every** read, update, and insert:

- `server/services/dispense.service.ts` — draft/confirm/deduct/emergency all use `and(eq(table.clinicId, clinicId), eq(table.id, …))`: e.g. `:138-142, :273-277, :297-301, :515-525, :535-545, :642-719, :724-731`.
- `server/routes/users.ts` — 12 handlers, all `and(eq(users.clinicId, clinicId), eq(users.id, req.params.id), …)`: `:292,326,369,374,422,428,499,516,568,616,687,704`.
- `server/routes/equipment.ts:506,880,904`; `server/routes/support.ts:164`; `server/routes/inventory-items.ts:128-145`.
- The "re-select by id alone" cases are **not IDOR**: each is either a re-read of a **server-generated** `randomUUID()` just inserted with `clinicId` (`containers.ts:197-212`, `inventory-items.ts:74-88`, `equipment-operational-state.ts:46-50,72-76,96-106`) or a re-read **after** a clinic-scoped existence guard (`inventory-items.ts:128-146`).

#### C3 — Authoritative clinic context cannot be spoofed by the client · `CONFIRMED ✅`
- Global chain (`server/index.ts:306-309`): `globalApiLimiter` → `i18nMiddleware` → `tenantContext` (best-effort) → `sessionContextMiddleware` (best-effort).
- `server/middleware/tenant-context.ts:24-63` is explicitly **best-effort** and never rejects; its dev-header/dev-default fallbacks are unreachable in production (`tenant-context.ts:30` gates `fromImplicitDevDefault` on non-production).
- Route-level `requireAuth` **overwrites** `req.clinicId` from the resolved DB user (`server/middleware/auth.ts:549-551, 649-651`), so for any guarded route the authoritative value wins. The client never supplies a trusted `clinicId` (confirmed: `src/lib/api.ts` carries `clinicId` only as a response type, no request header).
- A session whose org/clinic claim disagrees with the DB row is rejected with `TENANT_MISMATCH` when DB-fallback is disabled (`auth.ts:445-466`).

#### C4 — Prior IDOR (audit "G-1") already remediated and regression-locked · `CONFIRMED ✅`
- `tests/cross-tenant-denial.test.ts` proves clinic-B cannot mutate clinic-A `purchaseOrders`/`alertAcks` (404, no payload leak) **and** carries a source-level structural assertion (`:334-368`) that every `.from(purchaseOrders)`/`.from(alertAcks)` SELECT filtering by `id` also filters by `clinicId`.

**Answer — "is `WHERE clinic_id = ?` enforced everywhere?"** On every sampled path and on the two historically-vulnerable files (structurally tested): **yes**. Exhaustive proof across all 309 files is out of scope — see §3.

---

### 1.4 Database

#### D1 — Parameterization is consistent; SQL injection not present on audited surfaces · `CONFIRMED ✅`
- All dynamic SQL flows through Drizzle's parameterizing `sql` template or the query builder. The only `sql.raw` (`server/lib/role-notification-scheduler.ts:80`) interpolates `settingField`, whose type is a **compile-time union of 4 literal column names** (`role-notification-scheduler.ts:71-75`) — not user input.
- Raw `pool.query` calls are static strings with no interpolation: `server/lib/push.ts:710-714` (static DELETE), `server/migrate.ts:8`, `server/seed.ts:25`.
- Global recursive body XSS sanitization is applied to every JSON request (`server/index.ts:263-282`) on top of `helmet` (`:120`).

#### D2 — Locking and transaction boundaries are present and correct · `CONFIRMED ✅`
- **Cross-process queue safety:** outbox publisher selects `FOR UPDATE SKIP LOCKED` inside a transaction (`server/lib/event-publisher.ts:60-105`).
- **Advisory locks** serialize hot paths: clinic-scoped Code-Blue session create uses 64-bit `hashtextextended('code-blue-active-session:'||clinicId, 0)` inside a tx (`server/routes/code-blue.ts:393-396`); stale sweeps and semi-dock use `hashtext(...)` (`staleCheckoutSweepWorker.ts:67,96`, `semi-dock-notify.ts:104`).
- **Atomic multi-step mutations:** dispense confirm + deduction and PO receive run in `db.transaction` (`dispense.service.ts:268,642`, `procurement.ts:271-364`).

#### D3 — `containerItems`/`UPDATE`-by-id-only defense-in-depth gaps · `CONFIRMED ⚠️ (low severity)`
Two patterns rely on a preceding guard rather than an in-statement `clinicId`:

1. **UPDATE by id only** — `server/routes/procurement.ts:214-217, 360-363, 449-452` issue `db.update(purchaseOrders).set(...).where(eq(purchaseOrders.id, req.params.id))`. Each is preceded by a clinic-scoped existence SELECT that returns 404 (`:205-211, :255-261, :424-431`), so it is safe **today**. The P1 remediation hardened the trailing *SELECTs* (C4) but left these *UPDATEs* id-only — an inconsistency that becomes a cross-tenant write if the guard is ever refactored away.
2. **User-supplied `containerId` not clinic-verified** — PO receive looks up `containerItems` by `(containerId, itemId)` with **no** `clinicId` (`procurement.ts:294-298`) and, on miss, inserts a new `containerItems` row with the user-supplied `containerId` (`:326-332`). The clinic is taken from the (verified) PO, and `itemId` is clinic-scoped, so this cannot read or mutate another clinic's existing rows in practice; the worst realistic outcome is a self-inflicted integrity oddity in the caller's own clinic.

**Exploitability:** Constrained — UUID unguessability + transitive PO/item scoping. No demonstrable cross-tenant compromise. **Business impact:** Brittle invariant; recommend adding `eq(table.clinicId, clinicId)` to these statements to match the rest of the file.

---

### 1.5 Workers (BullMQ / Redis)

#### E1 — Idempotency = Redis cache + DB uniqueness (correct layering) · `CONFIRMED ✅`
- `server/lib/idempotency.ts` is explicitly a cache: "Redis acts as a cache only; DB uniqueness is the correctness guarantee" (`:69`) and "Unknown Redis state should not suppress first-time billing writes" (`:84`). Redis fail-open is therefore safe.
- The durable guarantee is DB-level: dispense uses a unique `idempotencyKey` with `onConflictDoNothing()` + replay-read (`dispense.service.ts:165-196, 733-762`).

#### E2 — Replay safety of the mutating path · `CONFIRMED ✅`
- Inventory deduction is **inline and idempotent at the confirm level**: `confirmDispense` early-returns when status is already `CONFIRMED`/`COMPLETED` (`dispense.service.ts:280-292`), so a duplicate confirm cannot double-deduct. The standalone deduction worker and the recovery scanner are **deprecated no-ops** (`server/workers/inventory-deduction.worker.ts:3-13`, `server/lib/inventory-job-recovery.ts:1-6`), so no second invoker exists.

#### E3 — Retry/backoff configured; DLQs exist for outbox and notifications · `CONFIRMED ✅ / ⚠️`
- Job definitions set bounded retries with exponential backoff (`server/jobs/definitions/index.ts:63-142`: `attempts` 1–3, `backoff: exponential`), applied via `mergeEnqueueJobOptions` (`server/jobs/registry.ts:66-69`, `enqueue.ts:168-181`).
- **Dead-letter handling exists** for notifications (`NOTIFICATION_DLQ_NAME` + `enqueueDeadLetterJob`, `server/workers/notification.worker.ts:13-16`) and for the realtime outbox (`startOutboxDlqScanner`, `outbox-dlq-scanner.ts`; classification in `outbox-error-classification.ts`; retry metadata write in `event-publisher.ts:126-153`).
- **⚠️ Gap:** the BullMQ *pilot* queues (`server/jobs/runtime.ts:183-208`) have **no dedicated DLQ** — exhausted jobs are dropped after `removeOnFail` retention and only logged (`runtime.ts:191-197`). `check-plug`/charge-alert is `attempts: 1` (`definitions/index.ts:63`), so a single transient failure loses that alert. Low severity (operational alert, not clinical state), but worth a DLQ or alarm.

---

### 1.6 State (Frontend)

#### F1 — Server state via React Query; offline via Dexie + sync-engine · `CONFIRMED ✅`
- Offline queue/replay with conflict handling and a circuit breaker: `src/lib/sync-engine.ts` — HTTP 409 → persisted conflict store (`:392-416`), circuit breaker on repeated failure (`:65-118,131,168,196`), bounded result taxonomy (`:266`).
- Emergency mutations are never queued offline (frozen-surface contract; classifier `src/lib/offline-emergency-block.ts`), preserving the "fail loud" Code-Blue rule.

#### F2 — No duplicated server/client ownership; Zustand is declared-but-unused · `CONFIRMED ⚠️ (hygiene)`
- `zustand@^5.0.12` is in `package.json` but has **zero imports anywhere in `src/`** (verified by exhaustive search incl. subpaths). The stated stack lists Zustand; the actual client state is React Query (server state) + a hand-rolled module store in `src/lib/api.ts` (`authStore`, `:107,148`) + Dexie (offline).
- **Positive consequence for the audit question** ("duplicated ownership?"): there is *no* Zustand↔React-Query overlap because Zustand isn't wired. **Hygiene impact:** an unused dependency is dead supply-chain surface and a stack-documentation drift; either adopt or remove it.

---

### 1.7 Webhooks (external attacker boundary) · `CONFIRMED ✅`
- **Clerk inbound** — svix signature verification with all three headers mandatory; missing → 400, invalid → 400; mounted before `express.json()` to preserve the raw body (`server/routes/webhooks.ts:59-89`, `server/index.ts:248-261`).
- **Integration inbound** — HMAC-SHA256 with **constant-time** comparison; format-validated, length-checked before `timingSafeEqual` (so no length-leak throw), empty-secret → false (`server/integrations/webhooks/verify-signature.ts:1-24`); invalid → 401 and persisted as `rejected_signature` (`inbound.router.ts:111-137`, `repository.ts:18`).

---

### 1.8 Tests · `CONFIRMED ✅`
All five mandated categories exist:

| Category | Evidence (representative) |
|----------|---------------------------|
| Tenant isolation | `tests/cross-tenant-denial.test.ts`, `equipment-readiness-rules.clinic-isolation.integration.test.ts`, `offline-session-clinic.test.ts`, `peer-cursor-prune-clinic-guard.test.ts`, `sw-api-cache-isolation.test.ts`, `ensure-user-clinic-membership.test.ts` |
| Authorization matrix | `require-clinical-authority.test.ts`, `authority-roles.test.ts`, `auth-hardening.test.ts`, `dispense-auth-hardening.test.ts`, `authority-enforcement-*.test.ts`, `auth-mode-resolution.test.ts` |
| Rollback | `authority-enforcement-rollback-invariant.test.ts`, `authority-task-assignment-rollback-invariant.test.ts`, `authority-task-assignment-wiring-rollback-invariant.test.ts` |
| Concurrency | `concurrency.test.js`, `code-blue-concurrent-session-guard.test.ts`, `code-blue-keepalive-invalidation-race.test.ts`, `p2-5-pending-sync-dedup-race.test.ts` |
| Worker retry / idempotency | `charge-alert-worker-unit.test.ts`, `container-dispense-idempotency.test.ts`, `equipment-replay-idempotency.{lib,routes,integration}.test.ts`, `outbox-error-classification.test.ts`, `task-ownership-backfill-worker.test.ts` |

---

## 2. Findings Disproven (hypotheses tested and rejected)

| # | Hypothesis | Why rejected | Evidence |
|---|-----------|--------------|----------|
| P1 | Role can be asserted from JWT/Clerk claims | Role is read only from `vt_users.role`; conflict-upsert excludes `role` | `auth.ts:484, 414-421` |
| P2 | Production can fall back to dev-bypass admin | Module-load guard throws; dev branch gated on `isDevelopment` | `auth.ts:138-140, 255` |
| P3 | `x-dev-*` / `x-dev-clinic-id-override` headers spoof identity in prod | Reachable only under `isDevelopment && dev-bypass`; tenant-context dev-default gated to non-prod | `auth.ts:255-267`, `tenant-context.ts:30` |
| P4 | Stability-token grants remote admin | Production restricts to loopback addresses; token random-if-unset | `auth.ts:241-253`, `stability-token.ts:2-3` |
| P5 | SQL injection via raw SQL | Only `sql.raw` is a 4-literal compile-time column union; all else parameterized | `role-notification-scheduler.ts:71-80` |
| P6 | IDOR on `GET/PATCH …/:id` (re-select by id only) | Each is a server-generated UUID re-read or follows a clinic-scoped guard | `containers.ts:197-212`, `inventory-items.ts:128-146`, `procurement.ts:205-217` |
| P7 | Cross-tenant mutation of purchase orders / alert acks | 404 before any leak; regression-locked behaviorally + structurally | `tests/cross-tenant-denial.test.ts` |
| P8 | Double inventory deduction on worker replay | Deduction inline + confirm is status-idempotent; worker/recovery are no-ops | `dispense.service.ts:280-292`, `inventory-deduction.worker.ts:3-13` |
| P9 | Redis outage causes duplicate billing/dispense writes | Idempotency is DB-uniqueness-backed; Redis is cache-only/fail-open-safe | `idempotency.ts:69,84`, `dispense.service.ts:165-196` |
| P10 | Webhook endpoints accept unsigned/forged payloads or leak via timing | svix verify (Clerk) + constant-time HMAC w/ length guard (integrations) | `webhooks.ts:70-89`, `verify-signature.ts:14-23` |
| P11 | Client-supplied `clinicId` header is trusted | No trusted client clinic input; `requireAuth` overwrites from DB user | `auth.ts:549-551`, `tenant-context.ts:24-63` |
| P12 | Zustand duplicates React Query server state (stale-state risk) | Zustand is unused (zero imports); no overlap exists | `package.json` vs. `src/**` search |

---

## 3. Insufficient Evidence (explicitly not proven)

| # | Item | Why unproven | What would close it |
|---|------|--------------|---------------------|
| I1 | "**Every** query in all 309 server files filters by `clinicId`" | Verified by sampling the highest-risk paths + the two structurally-tested files; a line-by-line sweep of all 48 routers, 23 services, 13 workers, and integration adapters was not performed | A repo-wide lint/AST rule asserting `clinicId` co-presence on every `vt_`-table predicate, or an exhaustive manual sweep |
| I2 | Tenant scoping of `poLines` (`procurement.ts:266,355,388,438`) and `containerItems` writes | These rely on *transitive* scoping (parent PO is clinic-verified) rather than an own `clinicId` predicate; schema-level FK/clinic columns for `vt_po_lines` were not opened | Confirm `vt_po_lines`/`vt_container_items` carry `clinicId` and add explicit predicates (see §1.4 D3) |
| I3 | BullMQ pilot-queue exhausted-job observability | Confirmed jobs are dropped + logged after `removeOnFail`; whether ops alerting surfaces these was not traced end-to-end | Trace `worker.on("failed")` → metric/alarm wiring, or add a pilot DLQ |
| I4 | Advisory-lock 32-bit `hashtext` collision impact | `staleCheckoutSweepWorker`/`semi-dock` use 32-bit `hashtext(id)`; collisions only over-serialize (no correctness loss), but contention behavior under load was not measured | Switch to 64-bit `hashtextextended` (as Code-Blue already does) or load-test |
| I5 | Runtime enforcement-mode matrix (`off/shadow/enforce`) per clinic in production | Code paths verified; live per-clinic flag/TTL values are runtime config, not in-repo | Inspect production flag store / `clinical-invariant.config` resolution at runtime |

---

## 4. Security Scorecard

| Domain | Rating | Basis |
|--------|--------|-------|
| **Authentication** | **Strong** | Single DB-authoritative identity (A1); prod-hardened (A2); override paths gated to loopback/dev/env (A3, A4). |
| **Authorization** | **Strong** | One clinical resolver, explicit per-stack admin-bypass flags, type-enforced student ceiling, fail-safe degradation (B1–B4). No bypass demonstrable. |
| **Multi-tenant isolation** | **Good, but app-only** | Discipline verified on all sampled paths + structural regression lock (C2–C4). **Risk:** no RLS backstop (C1) → single missing predicate = exposure; universality unproven (I1). |
| **Database** | **Strong** | Consistent parameterization, correct transaction/locking, global XSS sanitization (D1–D2). Two low-severity defense-in-depth gaps (D3). |
| **Workers** | **Good** | DB-uniqueness idempotency, status-idempotent mutation, bounded retries, outbox+notification DLQs (E1–E3). **Gap:** no pilot-queue DLQ; charge-alert `attempts:1`. |
| **State** | **Good** | React Query + Dexie/sync-engine with conflict store + circuit breaker; no server/client ownership duplication (F1). **Hygiene:** unused Zustand dependency (F2). |
| **Webhooks** | **Strong** | svix + constant-time HMAC with length guard; raw-body ordering correct (1.7). |
| **Tests** | **Strong** | All five mandated categories present, including a structural IDOR lock (1.8). |

### Prioritized remediations
1. **(Low, defense-in-depth)** Add `eq(table.clinicId, clinicId)` to the procurement `UPDATE`s and the `containerItems` lookup/insert (D3) so isolation no longer depends on the preceding guard. Verify `vt_po_lines`/`vt_container_items` carry `clinicId` (I2).
2. **(Strategic)** Evaluate PostgreSQL RLS (or a session-GUC tenant scope) as a backstop to the app-only model (C1) — converts I1 from "trust + sampling" into a database guarantee.
3. **(Operational)** Add a DLQ or failure alarm for BullMQ pilot queues; reconsider `attempts:1` on charge-alert (E3, I3).
4. **(Hygiene)** Remove or wire `zustand` (F2). Upgrade 32-bit advisory-lock hashes to 64-bit (I4). Treat `STABILITY_TOKEN`/`ADMIN_EMAILS` as audited production secrets (A3, A4).

---

*No speculative findings are included. Each item above is anchored to a cited file and line; hypotheses that the code disproved are recorded in §2; anything not exhaustively verifiable within scope is recorded in §3 rather than asserted.*
