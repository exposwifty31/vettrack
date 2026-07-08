# Tech Debt Register — Pre-Phase-7

**Date:** 2026-07-08 · **Basis:** [`PHASE_0-6_AUDIT_2026-07-08.md`](./PHASE_0-6_AUDIT_2026-07-08.md) + plan deferred-questions carryover
**Prioritization:** `Priority = (Impact + Risk) × (6 − Effort)`, each scored 1–5 (Effort inverted: lower effort → higher score).

## Summary

Total items: **13** | Critical: 0 | High (≥25): 3 | Medium (12–24): 7 | Low (<12): 3

Two provenances are merged here so Phase 7 has one backlog:
- **AUDIT** — surfaced by this session's verification (findings A-1…A-8).
- **PLAN** — already-known deferred items from `program-plan.md` "Deferred owner questions" (restated, not re-decided).

## Inventory

| # | Debt item | Type | Src | Impact | Risk | Effort | Priority |
|---|-----------|------|-----|--------|------|--------|----------|
| TD-1 | 14 `server/tests/*.test.ts` blocks run by no runner (silent zero-coverage) | Test | AUDIT A-1 | 3 | 4 | 2 | (3+4)×4 = **28** |
| TD-2 | `--status-stale` purple decision — gates 7c/7e readiness palette | Code/Design | PLAN | 3 | 2 | 1 | (3+2)×5 = **25** |
| TD-3 | 25 unused prod deps + 5 devDeps (0 imports confirmed) | Dependency | AUDIT A-2 | 2 | 3 | 2 | (2+3)×4 = 20 |
| TD-4 | Plan↔code drift: "fence /admin/metrics" still open in plan; code deliberately dropped it | Documentation | AUDIT A-4 | 2 | 2 | 1 | (2+2)×5 = 20 |
| TD-5 | `MAINTENANCE_MODE.md` frames repo as frozen; contradicts active program | Documentation | AUDIT A-5 | 2 | 2 | 1 | (2+2)×5 = 20 |
| TD-6 | Static-analysis test suite ≠ runtime proof (green CI, unwalked flows) | Test/Arch | AUDIT+PLAN | 4 | 4 | 4 | (4+4)×2 = 16 |
| TD-7 | 200 unused exports + 203 unused exported types (barrels + removed scope) | Code | AUDIT A-3 | 3 | 2 | 3 | (3+2)×3 = 15 |
| TD-8 | Ops-tile source convergence: `HomeTabletDashboard` render helpers duplicated in `surfaces/ops/` | Code | PLAN | 3 | 2 | 3 | (3+2)×3 = 15 |
| TD-9 | Worker "second backend" boundary (13 workers, ~50 scheduler starts) | Architecture | PLAN | 3 | 3 | 4 | (3+3)×2 = 12 |
| TD-10 | Nav deltas #1 (lead → `/admin/shifts`) + #3 (student loses code-blue init) dormant | Code | PLAN | 2 | 1 | 3 | (2+1)×3 = 9 |
| TD-11 | Ops "staffing" coverage — needs a new server read (ships as fleet coverage today) | Architecture | PLAN | 2 | 1 | 3 | (2+1)×3 = 9 |
| TD-12 | Postgres RLS as tenancy boundary (today app-layer + `tenant:lint` only) | Architecture/Sec | PLAN | 4 | 4 | 5 | (4+4)×1 = 8 |
| TD-13 | Stale `knip.json` ignore entries (`src/lib/tokens.ts`, `server/seed.ts`) | Config | AUDIT A-7 | 1 | 1 | 1 | (1+1)×5 = 10 |

## Phase 1 — Quick Wins (< 1 day each, do before/with Phase 7 branch)

1. **TD-1 — wire or delete the dead server tests.** A never-run `security.test.ts` is a false safety signal. Either add `server/tests/**` to a vitest include and fix whatever breaks, or delete if `tests/**` already covers it. *One-line config change; the cost is verifying the 14 blocks still pass.*
2. **TD-2 — get the `--status-stale` decision.** It's a one-token owner call (purple vs keep orange) that **blocks** the Phase 7c/7e readiness palette. Cheap to unblock, expensive to leave ambiguous (risks hardcoded purple in a slice).
3. **TD-4 / TD-5 / TD-13 — doc + config reconciliation.** Bring the plan-of-record and `MAINTENANCE_MODE.md` in line with reality, drop the stale knip ignores. Prevents a Phase-7 agent acting on a stale instruction.

## Phase 2 — Planned Refactors (fold into Phase 7's mandatory closing clean, III.7)

1. **TD-3 — dependency cull.** Remove the 25+5 unused deps in a `chore: clean` commit; re-run `knip` + `pnpm build` to confirm nothing cascaded. Some `@radix-ui/*` back unused `components/ui/*` — delete the UI file and the dep together, don't orphan one.
2. **TD-7 — export/type dead-weight classification.** Split into *migration scaffold* (hexagonal barrels — keep, they're the target state) vs *genuinely dead* (`src/types/billing.ts` and friends — delete). The clean sub-phase per III.7 is the sanctioned deletion path.
3. **TD-8 — ops-tile convergence.** A behavior-preserving, `data-testid`-stable extraction from `HomeTabletDashboard.tsx` so iPad-ops and phone/desktop-ops share one render source — do it when a phase legitimately owns that file (likely Phase 8).

## Phase 3 — Strategic (dedicated, owner-gated — NOT part of the UX/console/board program)

1. **TD-6 — behavioral/runtime coverage.** The suite is largely static-analysis style (`docs/testing-guide.md` self-describes it). Phase 10's four-platform re-walk is the current backstop; a longer-term investment is real E2E per critical flow. *Deferring is acceptable short-term because III.6 + the Phase-10 walk are the compensating control — but every phase that skips the live walk widens this gap.*
2. **TD-12 — Postgres RLS.** Legitimate defense-in-depth, but `clinicId on every query` is **Frozen** and changing the security boundary is a separately-reviewed hardening program — it must **never** be pulled into a UX phase.
3. **TD-9 — worker decomposition.** Real maintainability signal; Phase 7a Ops Health is the observability down-payment, the split itself is a Phase-10 roadmap item.
4. **TD-10 / TD-11 — nav deltas + staffing coverage.** Dormant seams awaiting their owning phase (nav models / a new server read). Not debt to pay now; tracked so they aren't lost.

---
_Scores are relative triage aids, not commitments. Re-score at each phase boundary as impact/risk shift._
