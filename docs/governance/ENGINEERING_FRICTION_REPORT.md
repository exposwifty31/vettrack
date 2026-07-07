# VetTrack — Engineering Friction Report

**Phase:** 5 — Engineering Friction Analysis  
**Generated:** 2026-06-18  
**Governor:** Product Engineering Governor  
**Prerequisites:** Phases 0–4 in [`docs/governance/`](./)

---

## Purpose

Identify where engineering time is lost, bugs originate, and onboarding or maintenance cost is disproportionate to product value. Estimates are **qualitative** (S/M/L engineering cost, product impact, risk) for prioritization in Phase 6.

**Scale:**

| Engineering cost | Meaning |
|------------------|---------|
| **S** | Hours–1 day per incident or fix |
| **M** | Days–1 week per meaningful change |
| **L** | Weeks+ or recurring tax on every touch |

| Product impact | Meaning |
|----------------|---------|
| **High** | Floor workflows, safety, release, or multi-clinic trust |
| **Medium** | Secondary features, admin, integrations |
| **Low** | Internal tooling, docs-only, optional surfaces |

| Risk | Meaning |
|------|---------|
| **Critical** | Security, cross-tenant, Code Blue, data loss |
| **High** | Production outage, wrong clinical/ops state |
| **Medium** | Regressions caught in CI or support |
| **Low** | Cosmetic, dev-only, degraded optional paths |

---

## Executive summary

| Friction theme | Eng. cost | Product impact | Risk | Priority |
|----------------|-----------|----------------|------|----------|
| Dual remote / stale GitLab `main` | **L** (ongoing) | **High** | **High** | P0 |
| Monolith hotspots (`equipment.ts`, `api.ts`) | **L** | **High** | **High** | P0 |
| Frozen realtime / PWA / Code Blue surfaces | **M** per touch | **High** | **Critical** | P0 (accept + document) |
| Scope-change naming residue | **M** | **Medium** | **Medium** | P1 |
| CI not enforced + dual pipelines | **M** | **High** | **High** | P0 |
| Testing gaps (DB, live-server, native) | **M** | **High** | **High** | P1 |
| Authority / enforcement wiring | **M** | **High** | **Critical** | P1 |
| Agent/onboarding context overload | **M** | **Medium** | **Medium** | P2 |
| Notification worker deploy split | **M** | **High** | **High** | P1 |
| Governance lints warn-only (G3–G5) | **S** per PR | **High** | **High** | P1 |

---

## 1. Areas slowing development

### 1.1 Dual Git remotes and divergent `main`

| Dimension | Assessment |
|-----------|------------|
| **Symptom** | Docs say GitLab canonical; `origin` = GitHub; `gitlab/main` 71 commits behind; 6 open GitLab MRs on stale base |
| **Engineering cost** | **L** — every agent/engineer asks "where do I push?" |
| **Product impact** | **High** — wrong code ships or MRs rebased twice |
| **Risk** | **High** |
| **Evidence** | [`docs/devops/github-setup.md`](../devops/github-setup.md) |

### 1.2 Monolith files (change blast radius)

| File | ~LOC | Symptom | Eng. cost | Product impact | Risk |
|------|------|---------|-----------|----------------|------|
| `server/routes/equipment.ts` | 5,600+ | Any equipment feature = huge diff, merge conflicts, slow review | **L** | **High** | **High** |
| `src/lib/api.ts` | 2,400+ | New endpoint = scroll/search; knip coupling | **L** | **High** | **Medium** |
| `server/lib/metrics.ts` + `audit.ts` | Large closed unions | Telemetry/audit additions touch many files | **M** | **Medium** | **Medium** |
| `.gitlab-ci.yml` + 8 workflow files | ~700+ | Dual maintenance on CI changes | **M** | **High** | **Medium** |

### 1.3 Frozen architecture surfaces (necessary friction)

| Surface | Symptom | Eng. cost | Product impact | Risk |
|---------|---------|-----------|----------------|------|
| SSE + outbox + BC gossip | High regression cost; Phase 9 drills required | **M** per change | **High** | **Critical** |
| PWA SW + emergency denylist | Easy to break cache rules | **M** | **High** | **Critical** |
| Code Blue online-only | Must touch client + server + tests | **M** | **High** | **Critical** |
| Authority evaluators | 6 families × route wiring | **M** | **High** | **Critical** |

*This friction is **intentional** for product safety — mitigate with docs and targeted tests, not removal.*

### 1.4 Scope-change cognitive load

| Symptom | Eng. cost | Product impact | Risk |
|---------|-----------|----------------|------|
| `appointments` vs Tasks vs `vt_tasks` | **M** — wrong table/API in every task | **Medium** | **Medium** |
| Legacy SPA redirects (~20 paths) | **S** — agents reintroduce removed routes | **Low** | **Low** |
| Stub workers still in schedulers | **S** — "why is this running?" | **Low** | **Low** |
| Stale docs (integrations guide, design handoff) | **S** — wrong implementation paths | **Medium** | **Medium** |

### 1.5 Local dev environment setup

| Step | Friction | Eng. cost | Notes |
|------|----------|-----------|-------|
| PostgreSQL 16 + user/db | **M** first time | **Medium** | Cloud agents need sudo/pg commands |
| `PORT=3001` + `pnpm dev` | **S** | **Low** | Documented; `predev` helps |
| Clerk vs dev-bypass | **M** when task needs real auth | **Medium** | Browser Clerk errors without keys |
| Redis optional | **S** | **Low** | Workers log disabled — surprises in queue features |
| Migrations at boot | **S** | **Low** | Failure blocks schedulers — good but abrupt |

**Reference:** `docs/cloud-agent-starter-skill.md`, `AGENTS.md`

### 1.6 PR / CI feedback loop

| Symptom | Eng. cost | Product impact | Risk |
|---------|-----------|----------------|------|
| ~5–7 min CI + Playwright (when both run) | **S** per push | **Medium** | **Low** |
| No branch protection — red `main` possible | **M** rework | **High** | **High** |
| `cursor/**` gets unit CI but not Playwright without PR to `main` | **M** for agents | **Medium** | **Medium** |
| GitLab missing `contracts-gate.sh` | **M** false confidence on GitLab MRs | **High** | **High** |

---

## 2. Areas causing bugs

### 2.1 Multi-tenancy (`clinicId`)

| Pattern | Bug class | Eng. cost to fix | Product impact | Risk |
|---------|-----------|------------------|----------------|------|
| Missing `eq(table.clinicId, clinicId)` on target table | Cross-clinic leak | **M** per incident | **High** | **Critical** |
| Tenancy via join only | False sense of security | **M** | **High** | **Critical** |
| G3 tenant lint false positives | Waiver fatigue → real misses ignored | **S** ongoing | **High** | **High** |

**Evidence:** `docs/architecture/governance-known-limitations.md` (~245 baseline warnings on full scan)

### 2.2 Auth and role resolution

| Pattern | Bug class | Risk |
|---------|-----------|------|
| Trusting JWT role vs `vt_users.role` | Authorization bypass | **Critical** (guarded by convention) |
| `ADMIN_EMAILS` per-request promotion | Demoted admin re-promoted | **High** — backlog item 6 |
| Dev headers in production path | Identity spoof | **Critical** (dev-bypass only in non-prod) |
| Clerk `authorizedParties` / native OAuth | Sign-in loops, 401 storms | **High** — recent `main` CI failures |

### 2.3 Realtime / offline race conditions

| Pattern | Bug class | Eng. cost | Risk |
|---------|-----------|-----------|------|
| Overlapping replay in `useRealtimeReconciliation` | Stale UI, missed events | **M** | **High** |
| Offline sync without emergency block | Code Blue queued | **M** | **Critical** (blocked by design) |
| Split-version / SW cache mismatch | Wrong bundle, stale board | **M** | **High** |
| Dexie schema bump forgotten | Offline data loss | **M** | **High** |

**Evidence:** `docs/validation/phase-10-stabilization-report.md`

### 2.4 Equipment operational state

| Pattern | Bug class | Eng. cost | Risk |
|---------|-----------|-----------|------|
| Waitlist promotion on wrong event | Wrong holder notified | **M** | **High** |
| Optimistic locking (`version`) ignored | Lost updates | **M** | **High** |
| Stale checkout push hardcoded Hebrew | EN users get wrong copy | **S** | **Medium** — backlog item 3 |
| Charge-alert job not cancelled on return | False alerts | **S** | **Medium** |

### 2.5 Integration sync

| Pattern | Bug class | Eng. cost | Risk |
|---------|-----------|-----------|------|
| Adapter throws mid-sync | Partial state, conflict backlog | **M** | **Medium** |
| Credential rotation without re-encrypt | Sync auth failures | **S** | **Medium** |
| Docs reference removed patient tables | Wrong adapter implementation | **S** | **Low** |

### 2.6 Native / mobile

| Pattern | Bug class | Eng. cost | Risk |
|---------|-----------|-----------|------|
| Capacitor Clerk session vs web | Auth loops, rejected builds | **L** | **High** |
| Missing legal pages for store URLs | Submission blocked | **S** | **High** |
| `notification.worker` not running in prod | Push silently absent | **M** to diagnose | **High** |

---

## 3. Areas difficult to test

### 3.1 Excluded from default `pnpm test`

| Suite | Requires | Gap severity | Product impact | Risk |
|-------|----------|--------------|----------------|------|
| `tests/restock.service.test.ts` | DB + migrations | **Medium** | Inventory | **Medium** |
| `tests/migrations/**` | DB | **Medium** | Schema | **High** |
| `tests/charge-alert-worker.test.js` | Live server :3001 | **Medium** | Equipment alerts | **Medium** |
| `tests/returns-api.test.js` | Live server | **Medium** | Returns flow | **Medium** |
| `tests/code-blue-mode-equipment.test.js` | Live server | **High** | Code Blue | **High** |
| `tests/expiry-*` | Live server / worker | **Low** | Expiry cron | **Low** |

**Friction:** Engineers assume `pnpm test` green = safe; **it is not full coverage**.

### 3.2 E2E and Playwright

| Aspect | Difficulty | Notes |
|--------|------------|-------|
| Local Playwright | **M** — build, migrate, seed, start API | Scripted in CI; heavy locally |
| Phase 9 drills | **M** — frozen transport contracts | In CI suite when `PW_SUITE=ci` |
| Staging E2E | **L** — needs `TEST_BASE_URL_STAGING`, Clerk test keys | Manual/nightly only |
| Signup flow | **L** — `sk_test_` Clerk required | Excluded from default CI |

### 3.3 Authority evaluators

| Aspect | Difficulty | Risk |
|--------|------------|------|
| `shadow` vs `enforce` per clinic | **L** — needs clinic config + DB fixtures | **High** |
| Strategy A vs check-in path | **M** — two authority branches | **High** |
| Fail-open carve-out | **M** — must assert audit kind emitted | **Medium** |

### 3.4 BullMQ / Redis workers

| Aspect | Difficulty | Notes |
|--------|------------|-------|
| Local without Redis | Workers disabled — **untested locally** | **Medium** friction |
| Integration worker | **M** — needs Redis + adapter mocks | |
| Separate `pnpm worker` process | **M** — easy to forget in manual QA | Push path |

### 3.5 Native builds

| Aspect | Difficulty | Product impact |
|--------|------------|----------------|
| iOS archive / Xcode | **L** — macOS only, not in CI | App Store |
| Android release bundle | **M** — manual job in MR !20 | Play Store |
| `scripts/verify-resubmission.sh` | **M** — human gate | Resubmission |

---

## 4. Areas difficult to onboard into

### 4.1 Context volume for agents and humans

| Barrier | Symptom | Eng. cost | Mitigation exists? |
|---------|---------|-----------|-------------------|
| `.cursorrules` + `CLAUDE.md` + 64 agents + 200+ skills | Rule overload, contradictory remote docs | **M** first week | Partial — governance docs now |
| Phase 6/9 frozen namespaces | "Why not rename appointments?" | **S** recurring | `CONTEXT.md` |
| 44 route modules + 62 tables | No mental map | **M** | [`ARCHITECTURE_MAP.md`](./ARCHITECTURE_MAP.md) |
| Equipment operational state model | Multi-axis state unfamiliar | **M** | `AD-02`, `CONTEXT.md` |

### 4.2 Finding the right extension point

| Task | Where newcomers look | Where it actually lives | Friction |
|------|---------------------|-------------------------|----------|
| New API endpoint | Random route file | `server/routes/` + `src/lib/api.ts` + types | **M** |
| New background job | New worker file | `start-schedulers.ts` + maybe `jobs/runtime.ts` | **M** |
| New realtime event | SSE handler | Outbox insert in same tx as mutation | **L** |
| New user-facing string | TS literal | `locales/en.json` + `he.json` | **S** (enforced by tests) |
| Schema change | `db.ts` only | `server/schema/*.ts` → drizzle generate → migrate | **M** |

### 4.3 Feature folder inconsistency

| Pattern | Friction |
|---------|----------|
| Most UI in `src/pages/` + `src/components/` | **M** — hard to find feature boundaries |
| Only 4 folders in `src/features/` | Inconsistent modularization |
| `server/domain/equipment/` emerging | Split brain with `equipment.ts` route |

### 4.4 Cross-repo contracts

| Barrier | Eng. cost | Product impact |
|---------|-----------|----------------|
| `@vettrack/contracts` in `literate-dollop` | **M** — bump dep + `contracts-gate.sh` | Mobile/offline parity **High** |
| Expo/RN vs Capacitor docs | **M** confusion | **Medium** |

---

## 5. Areas difficult to maintain

### 5.1 Dead code and stubs

| Item | Maintenance tax | Recommendation class |
|------|-----------------|----------------------|
| `inventory-deduction.worker` no-op | **S** per registry change | REMOVE |
| `procedureBoundReleaseWorker` no-op tick | **S** CPU + confusion | REMOVE |
| `evaluateDispenseAgainstOrders` empty | **S** misleading readers | LEGACY doc or remove |
| `er-mode-permissions.ts` | **S** | Audit callers |
| ~20 legacy redirects | **S** (cheap to keep) | LEGACY keep |

**knip not in CI** — dead exports accumulate (**M** long-term tax).

### 5.2 Documentation drift

| Doc | Drift | Eng. cost |
|-----|-------|-----------|
| `docs/integrations-guide.md` | Patient tables removed | **S** per wrong PR |
| Design handoff README | ER/meds surfaces listed | **S** |
| `CONTRIBUTING.md` remote = GitLab | `origin` is GitHub | **S** confusion |
| `docs/runbooks/activate-admin-email.md` | "Promotes on login" stale | **S** — item 6 backlog |

### 5.3 i18n maintenance

| Aspect | Friction | Risk |
|--------|----------|------|
| ~3000+ keys × 2 locales | **M** per feature | **Medium** |
| Server-only keys (`staleCheckout.*`) | Easy to forget frontend parity rule doesn't apply | **Low** |
| Hardcoded Hebrew in workers | **S** fix, **M** if pattern repeats | **Medium** |
| Parity only in manual release-gate | Drift reaches `main` | **Medium** |

### 5.4 Operational runbooks scattered

Runbooks live across `docs/devops/`, `docs/mobile/`, `RESUBMISSION_RUNBOOK.md`, `docs/cloud-agent-starter-skill.md`, `.cursor/plans/`. **M** friction finding the right runbook under incident pressure.

---

## 6. Friction heat map (by domain)

```
                    TEST DIFFICULTY
                    Low    Med    High
ONBOARDING  Low  │      │ i18n │ authority
DIFFICULTY  Med  │admin │tasks │ equipment.ts
            High │      │integrations│ realtime/PWA/CB
```

**Maintainability** worst in: equipment routes, api.ts, dual CI, stub workers, metrics/audit unions.

---

## 7. Estimated aggregate cost (annualized, team-of-one maintainer proxy)

| Category | Est. % of engineering time | Driver |
|----------|---------------------------|--------|
| Frozen surface caution + Phase 9 adjacency | 15–20% | Every touch near realtime/emergency |
| Monolith navigation + review | 15–20% | equipment.ts, api.ts |
| Remote/CI/process overhead | 10–15% | Dual git, manual local gates |
| Scope residue + naming | 5–10% | appointments/Tasks, docs drift |
| Test gap surprises | 10–15% | Excluded suites, native manual |
| Onboarding/context (agents included) | 10–15% | Rule sprawl, 44 routes |
| **Productive feature work** | **25–35%** | Remainder |

*Rough order-of-magnitude for prioritization — not a time study.*

---

## 8. Friction reduction opportunities (input to Phase 6)

Grouped by **product outcome**, not cleanliness:

| Opportunity | Reduces | Eng. effort | Product ROI |
|-------------|---------|-------------|-------------|
| Single canonical `main` + remote | Merge confusion, stale MRs | M | **Very high** |
| Branch protection + required CI/E2E | Broken `main`, rework | S | **Very high** |
| Split `equipment.ts` along custody/waitlist/scan seams | Review time, bug blast radius | L | **High** |
| `resolve-user-locale` + stale-checkout tests (item 3) | EN push bugs | M | **High** |
| knip in CI (weekly) | Dead code tax | S | **High** |
| Fix top 5 stale docs | Agent wrong paths | S | **Medium** |
| Notification worker deploy doc + health check | Silent push failure | M | **High** |
| Promote G3 tenant lint scope fix (G6) | Tenancy misses | M | **High** |
| Code tour (`.tours/`) | Onboarding | S | **Medium** |
| Remove no-op workers | Scheduler noise | S | **Low** (but cheap win) |

**Explicitly defer (low product ROI):** cosmetic refactors, renaming `appointments` internal surfaces (Phase 6 §17 forbidden), consolidating `src/features/` without feature pressure.

---

## 9. Risk register (friction → incident)

| ID | Friction source | Likely incident | Likelihood | Severity |
|----|-----------------|-----------------|------------|----------|
| F1 | Ungated `main` | Regressed production deploy | Medium | High |
| F2 | GitLab MR on stale base | Bad merge / lost GitHub fixes | High | High |
| F3 | equipment.ts change without E2E | Waitlist/checkout regression | Medium | High |
| F4 | notification worker not deployed | Missed waitlist/stale pushes | Medium | High |
| F5 | Tenant lint waiver fatigue | Cross-clinic query | Low | Critical |
| F6 | Realtime change without drills | Ward board stale | Low | High |
| F7 | Native ship without release-gate | Store rejection | Medium | Medium |
| F8 | Contracts drift vs literate-dollop | Mobile offline break | Medium | High |

---

## 10. Who feels which friction

| Persona | Top friction |
|---------|--------------|
| **Solo maintainer / agent** | Remote confusion, rule volume, monolith files |
| **New human engineer** | Architecture map, frozen surfaces, dev setup |
| **Floor product (indirect)** | Push locale bugs, stale board, waitlist delays |
| **Release owner** | Native manual gates, no tagged releases, dual CI |
| **Enterprise integrator** | Adapter docs drift, sync observability |

---

## Next phase

**Phase 6 — Prioritized Improvement Plan** → `PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md` (P0–P3 objectives with business/engineering impact, effort, ROI).

**Optional:** `.tours/governance-architect-delivery.tour` per [`code-tour-integration.md`](../../.cursor/skills/product-engineering-governor/code-tour-integration.md) to reduce onboarding friction (Phase 5 finding §4).
