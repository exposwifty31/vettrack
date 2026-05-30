# VetTrack — Bug Hunt & Hardening Register (Section F)

**Generated:** 2026-05-21  
**Audited branch:** `staging` (read-only code review; no app/server/test changes in this PR)  
**Companion artifacts:** `TEST_AUDIT.md`, `FLOW_MATRIX.md`, `scripts/run-safe-tests.sh`

Register defects **before** fix PRs. Severity: **P0** (prod/safety/data loss) · **P1** (high) · **P2** (medium) · **P3** (low / hygiene).

---

## Audit scope & method

| Area | Method |
|------|--------|
| Auth / RBAC | Static review of `server/middleware/auth.ts`, route guards, `tests/*-hardening*` |
| Multi-tenancy | `tests/multi-tenancy-hardening.test.js` + spot-check of `eq(table.clinicId, clinicId)` |
| Contracts | Compare `src/lib/api.ts`, `src/lib/er-api.ts`, `shared/`, route handlers |
| Inventory / billing | Schema (`server/db.ts`), services, `tests/billing-leakage*`, `data-integrity-hardening` |
| Concurrency | `tests/concurrency.test.js`, equipment/checkout paths, outbox/SSE docs |
| Error UX | `src/lib/sync-engine.ts`, `sync-status-banner`, `apiError` envelopes |
| Timezone | `appointments.service.ts` day boundaries, scheduling tests |
| Performance | Hot-path grep, `vite.config.ts`, realtime publisher constants |
| Security | Helmet/CSP, rate limits, health endpoints, i18n Hebrew debt |
| Deployment | `.github/workflows/*`, `server/index.ts` boot order, staging scripts |

**Out of scope for this PR:** fixes, migrations, Railway/Clerk/DB changes.

---

## 1. Contract drift

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| CD-01 | ~~`ER_API_IMPLEMENTED_ROUTES` lists `GET /api/er/queue`~~ **CLOSED** — route omitted from implemented list (handler remains 501) | P2 | `src/lib/er-api.ts` L51–52 comment; pre-demo audit mainline | — |
| CD-02 | `tests/pwa.spec.ts` uses `BASE_URL` default **`:5000`** while CI/Playwright config uses **`:3001`** | P2 | `tests/pwa.spec.ts` L36; `playwright.config.ts` L14; `.github/workflows/playwright.yml` L96 | Default to `process.env.TEST_BASE_URL` only (no localhost:5000 fallback when unset) |
| CD-03 | Raw `fetch()` bypasses `src/lib/api.ts` offline queue / 401 guard | P2 | `src/hooks/use-auth.tsx` (`/api/users/me`, `/api/users/sync`); `src/lib/sync-engine.ts` L274; `src/pages/app-tour.tsx` L41 | Route through `request()` or document explicit exceptions |
| CD-04 | `main` vs `staging` tooling split (staging Playwright, `scripts/staging/*`, runbooks) | P2 | `TEST_AUDIT.md`; `package.json` `test:staging:*` only on staging branch | Promote via explicit release PR; document in CONTRIBUTING |
| CD-05 | Vitest default excludes live-server / DB suites — CI green does not imply full API coverage | P3 | `vite.config.ts` exclusions; `TEST_AUDIT.md` | Document required manual/DB jobs per release |

---

## 2. Auth & role enforcement

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| AU-01 | ~~CI Playwright ran full `*.spec.ts` including signup-flow~~ **CLOSED** — CI uses `pnpm test:playwright:ci` allowlist | P1 | `.github/workflows/playwright.yml`; `scripts/run-safe-tests.sh` | — |
| AU-02 | ~~ER handoff ack missing route role guard~~ **CLOSED** — `requireAssignableRole` on `POST /handoffs/:id/ack` | P2 | `server/routes/er.ts` L797; `tests/er-handoff-ack-role-denial.test.ts` | — |
| AU-03 | Dev headers (`x-dev-role-override`, etc.) only in dev-bypass | P3 | `server/middleware/auth.ts`; `AGENTS.md` | Document for E2E; never set in production env |
| AU-04 | ~~`tests/example.spec.ts`~~ **CLOSED** — file removed; allowlist in `playwright.shared.ts` only | P3 | pre-demo audit mainline | — |
| AU-05 | `ROLE_HIERARCHY` includes `lead_technician` / `vet_tech` but `requireClinicalUser` Set omits them (normalized elsewhere) | P3 | `server/middleware/auth.ts`; `tests/dispense-auth-hardening.test.ts` | Document alias normalization path; avoid duplicate guards |

---

## 3. Validation

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| VA-01 | Most route Zod schemas are **not** `.strict()` — unknown JSON fields silently dropped | P2 | Only `restock.ts`, `clinical-check-in.ts` use `.strict()` (repo grep) | Inventory high-risk routes; add negative tests |
| VA-02 | Broad validator surface — spot-check only in this audit | P2 | `server/routes/*` + `validateBody` | Per-route-family negative Vitest matrix |
| VA-03 | Appointment/task datetime parsing requires offset/Z — good — but callers may still send local strings from UI | P3 | `appointments.service.ts` `parseAppointmentInstant` (~L826–845) | Add API contract test + UI lint for ISO with offset |

---

## 4. Inventory & billing integrity

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| IB-01 | Async inventory deduction after `completeTask` (brief billing vs stock skew) | P3 (known) | `CLAUDE.md`; `vt_inventory_jobs` + recovery scheduler | Monitor; document in ops runbook |
| IB-02 | Billing idempotency enforced in schema | — | `vt_billing_ledger.idempotency_key` unique; `tests/billing-leakage*` | ✅ Keep regression tests |
| IB-03 | Negative on-hand blocked at DB for containers (`CHECK quantity >= 0`) — confirm in pilot clinic | P1 ops | Migration `125_inventory_negative_quantity_guard.sql`; `tests/inventory-negative-quantity-guard.test.ts` | Run `/api/health/data-integrity` + concurrent dispense drill before go-live |
| IB-04 | Inventory job failure UX separate from sync queue | P3 | `src/pages/inventory-jobs.tsx` failed filter | Ensure operators see retry path after worker exhaustion |

---

## 5. Concurrency

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| CO-01 | ~~Equipment `version` optimistic locking unused~~ **CLOSED** — PATCH/checkout/return increment `version` and return `VERSION_CONFLICT` 409 | P1 | `server/routes/equipment.ts`; `tests/equipment-version-occ.integration.test.ts` | — |
| CO-02 | Checkout/return combine status **409** with version OCC where applicable | P2 | `server/routes/equipment.ts` | Document dual concurrency story in equipment runbook |
| CO-03 | SSE reconnect storm / gap resync | P2 | Phase 9 drills; `tests/phase-9-deterministic-drills.test.ts` | Keep drills nightly; non-blocking on PR |
| CO-04 | Double-submit on rapid scan not covered by Playwright | P2 | `FLOW_MATRIX.md` scan row ❌ | Add `tests/e2e/flows/` duplicate-scan spec |

---

## 6. Error UX

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| EU-01 | ~~Permanent sync failure with no operator toast~~ **CLOSED** — `toast.error(t.layout.sync.failedMessage)` + open sync queue action | P2 | `src/lib/sync-engine.ts`; `tests/sync-engine-permanent-failure-toast.test.ts` | — |
| EU-02 | Phase 5 error contract tests exist | — | `tests/phase-5-error-contract.test.js` | ✅ Maintain on API changes |
| EU-03 | ~~Hardcoded Hebrew in crash-cart~~ **CLOSED** — uses `t.crashCart.*` | P2 | `src/pages/crash-cart.tsx`; `locales/en.json` / `he.json` | — |
| EU-04 | `ErApiNotImplementedError` exists but queue route returns generic 501 JSON | P3 | `src/lib/er-api.ts` L22–27; server `COMING_SOON` | Map 501 to typed client error if UI calls queue |

---

## 7. Timezone correctness

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| TZ-01 | ~~"Today" tasks used UTC midnight~~ **CLOSED** — `getClinicTimezone` + `getClinicDayUtcRange` / `clinicTodayIsoDate` | P2 | `server/lib/clinic-timezone.ts`; `tests/clinic-timezone.test.ts` | — |
| TZ-02 | Scheduling tests exist but limited DST edge coverage | P3 | `tests/appointments-scheduling.test.js` | Add DST + Asia/Jerusalem cases |
| TZ-03 | Authority cache comment: server-local date vs clinic TZ | P3 | `server/lib/authority-cache.ts` L41 | Document or align evaluator "day" with clinic |

---

## 8. Performance

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| PF-01 | SSE storm hint at ≥50 connects / 5s — no load harness in repo | P2 | `CLAUDE.md` realtime doctrine; no k6/`load/` | Add optional k6 script or document manual soak |
| PF-02 | N+1 risk on equipment list / ER board | P3 | Not profiled in audit | Profile hot routes; add selective joins |
| PF-03 | Vite manual chunks for vendors | — | `vite.config.ts` | ✅ |
| PF-04 | Playwright CI `workers: 1`, 12m `globalTimeout` — long PR feedback | P3 | `playwright.config.ts` L47–56 | Split job or shard by spec dir |

---

## 9. Security

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| SE-01 | Clerk **live** keys in git history (ops) | P0 ops | `docs/runbooks/1.4-clerk-key-rotation.md` | Execute rotation runbook if not done |
| SE-02 | Helmet / CSP / XSS sanitizer | — | `server/index.ts` | ✅ |
| SE-03 | Rate limits (global + scoped) | — | `server/middleware/rate-limiters.ts` | ✅ |
| SE-04 | Production rejects test Clerk keys | — | `envValidation` patterns in tests | ✅ |
| SE-05 | ~~Data-integrity health probe open when token unset~~ **CLOSED** — production returns 503/401; token required at boot (`envValidation.ts`) | P2 | `server/routes/health.ts`; `tests/health-data-integrity.routes.test.ts` | — |
| SE-06 | Hebrew in server forecast email builder (allowlisted) | P3 | `tests/i18n-no-hebrew-in-source.test.ts` allowlist | Phase 6 extraction PRs |
| SE-07 | `SMART_COP_VALIDATION_FAIL_OPEN=true` allows clinical evaluator fail-open | P2 (config) | `server/lib/clinical-invariant-error.ts` L160 | Ops: keep false in prod; monitor `clinical_invariant_fail_open` audit |

---

## 10. Deployment correctness

| ID | Finding | Sev | Evidence | Suggested fix |
|----|---------|-----|----------|---------------|
| DP-01 | Migrations before schedulers | — | `server/index.ts` `runMigrations()` before schedulers | ✅ |
| DP-02 | Vite dev proxy → API `:3001` | — | `vite.config.ts` | ✅ |
| DP-03 | ~~CI not on `staging` branch~~ **CLOSED** — `ci.yml` and `playwright.yml` include `staging` | P1 | `.github/workflows/ci.yml` L5–7 | — |
| DP-04 | Release Gate duplicates Vitest subsets on `main` push | P3 | `release-gate.yml` vs `ci.yml` | Consolidate or mark optional checks |
| DP-05 | `RAILWAY_USE_CLI_DEPLOY` skips deploy jobs when false | P3 | `ci.yml` deploy jobs | Document in CONTRIBUTING |
| DP-06 | Redis optional in dev — queues log disabled | P3 | `CLAUDE.md`; worker startup logs | Production checklist: Redis required |

---

## Test / CI hygiene (cross-cutting)

| ID | Finding | Sev | Suggested fix |
|----|---------|-----|---------------|
| TI-01 | Safe runner allowlist ≠ CI Playwright scope | P1 | Align `playwright.yml` with `scripts/run-safe-tests.sh` |
| TI-02 | No `tests/e2e/simulation` in default CI | P3 | Nightly workflow on staging |
| TI-03 | Live-server Vitest excluded by default | P3 | Document in `TEST_AUDIT.md` release checklist |
| TI-04 | `signup-flow` / `ui-smoke` not in safe runner but in CI | P1 | Same as AU-01 / TI-01 |

---

## Verified strengths (no open ID)

| Area | Note |
|------|------|
| ER `PATCH /mode` | Implemented (`applyGlobalErModeToggle`) — not 501 |
| Handoff ack authorization | Service-layer owner / admin-vet override works |
| Dispense router | `requireAuth` + `requireClinicalUser` at router level |
| Data integrity migration | Views + health endpoint + advisory locks |
| Code Blue offline block | `tests/code-blue-offline-queue-removed.test.ts` |
| Playwright prod URL guard | `playwright.config.ts` warns on staging/production hosts |

---

## Prioritized bug list (fix order)

### P0 / ops (outside code PR scope unless assigned)

1. **SE-01** — Clerk live key rotation (runbook)

### P1 — safety & CI signal (open)

1. **IB-03** — Negative inventory: DB constraints shipped; **confirm** in pilot clinic via data-integrity probe + concurrent dispense drill
2. **TI-01** — Keep CI Playwright aligned with `scripts/run-safe-tests.sh` on workflow changes

### P2 — correctness & UX (open)

1. **CD-01** — ER queue 501 vs documented API (client must not call)
2. **CD-02 / CD-03** — PWA base URL; api.ts bypass (documented exceptions)
3. **VA-01** — Zod strictness on sensitive routes
4. **CO-02 / CO-04** — Equipment concurrency documentation + duplicate-scan e2e
5. **PF-01** — Realtime load documentation or k6
6. **IB-04** — Inventory job alerting beyond admin UI (ops dashboard tie-in)

### P3 — hygiene & docs

Remaining CD-04/05, VA-02/03, IB-01/04, TZ-02/03, PF-02/04, DP-04–06, SE-06/07, AU-03–05, TI-02/03

---

## Suggested follow-up PR order

| PR # | Branch theme | IDs | Risk | Rollback | Validation |
|----|--------------|-----|------|----------|------------|
| 1 | `cursor/ci-playwright-allowlist-*` | AU-01, TI-01, TI-04 | Low | Revert workflow | Green `playwright.yml` on PR; no signup in log |
| 2 | `cursor/ci-staging-branch-*` | DP-03 | Low | Revert workflow branches | PR to `staging` runs `ci.yml` |
| 3 | `cursor/equipment-version-occ-*` | CO-01, CO-02 | Med | Revert routes; DB column nullable | Vitest concurrency + manual double PATCH |
| 4 | `cursor/appointments-clinic-tz-*` | TZ-01, TZ-03 | Med | Feature flag clinic TZ | Extend `appointments-scheduling.test.js` |
| 5 | `cursor/sync-failure-ux-*` | EU-01 | Low | Revert toast | Manual offline retry exhaustion |
| 6 | `cursor/er-contract-queue-*` | CD-01, EU-04 | Low/Med | Implement or remove client | ER integration test |
| 7 | `cursor/pwa-base-url-*` | CD-02 | Low | Revert spec default | `PLAYWRIGHT_E2E=1` safe runner |
| 8 | `cursor/api-client-unify-*` | CD-03 | Med | Per-file revert | Auth + sync offline tests |
| 9 | `cursor/zod-strict-routes-*` | VA-01, VA-02 | Med | Per-route revert | Negative body tests |
| 10 | `cursor/health-data-integrity-auth-*` | SE-05 | Low | Env-only | 401 without token in prod |
| 11 | `cursor/i18n-crash-cart-*` | EU-03 | Low | Revert locales | `i18n-no-hebrew` allowlist shrink |
| 12 | `cursor/er-handoff-route-guard-*` | AU-02 | Low | Revert middleware | Role denial 403 test |
| 13 | `cursor/inventory-negative-guard-*` | IB-03 | High if wrong | Revert service check | `data-integrity` + dispense integration |
| 14 | `cursor/e2e-duplicate-scan-*` | CO-04 | Low | Delete spec | Playwright flow green |

Each fix PR should include: **Risk**, **Rollback**, **Validation**, **Deployment impact** (per hardening execution plan).

---

## Changelog (Section F register)

| Date | Change |
|------|--------|
| 2026-05-21 | Full Section F audit on `staging`; corrected CO-01 (equipment version); added TZ-01, CD-01, DP-03, EU-01, SE-05; refreshed Playwright CI notes |
| 2026-05-30 | Pre-pilot closure pass on `main`: CO-01, TZ-01, AU-01/02, DP-03, EU-01, SE-05 marked closed; production boot requires `CLERK_WEBHOOK_SECRET` + `DATA_INTEGRITY_HEALTH_TOKEN`; inventory jobs runbook added |
