# Relevance Baseline (Phase 0)

**Generated:** 2026-07-06 · **Branch:** `claude/phase-0-baseline` · **Scope:** whole repo · **Mode:** report-only (no deletions).

Per Part II.2 of the program plan, the repo carries irrelevant docs, dead code, idea-only flows, and flows that never reach the frontend. This document is the program's living relevance baseline: every later phase consults it before extending anything; every sanctioned clean sub-phase (III.7) updates it. **Phase 0 deletes nothing** — deletion happens only inside a phase's closing clean sub-phase, cross-checked with `knip` + reference grep + green `typecheck`/`test`.

## Method

Two complementary lenses, reconciled — neither is trusted alone (II.2: *existence ≠ relevance*, and tool output over-reports):

1. **File-level classification** — the prior `vettrack-codebase-relevance-audit` run, persisted at [`codebase-relevance-classification.json`](./codebase-relevance-classification.json). Every tracked file classified from observable evidence (imports, route registration, build config, package scripts, test refs, generated-output conventions, git history, frozen-surface constraints).
2. **Dead-code signal** — `pnpm knip` run fresh on this branch (informational; **not** part of `architecture:gates`). Surfaces unused files/exports/deps that the file-level pass may not, but over-reports entry points, barrels, and lazy-loaded routes.

## Lens 1 — file classification (authoritative file-level baseline)

From `codebase-relevance-classification.json` (2584 tracked files):

| Classification | Count | Meaning |
|---|---:|---|
| `keep-app` | 897 | Reachable application code |
| `keep-support` | 1320 | Tests, docs, agent/skill assets, ops scripts |
| `uncertain` | 318 | Needs per-phase reachability confirmation before building on |
| `generated-or-ephemeral` | 38 | Build output / generated artifacts |
| `delete-candidate` | 11 | High-confidence removable — **queued, not removed in Phase 0** |

The 11 `delete-candidate` rows are the highest-confidence removal queue. They are **not** touched here; each is removed only if and when a phase's clean sub-phase owns its surface (III.7), or reported to the owner if out of every fence.

## Lens 2 — knip dead-code signal (fresh, informational)

`pnpm knip` on this branch (exit 1 — knip exits non-zero on any finding; this does not fail the gate):

| Category | Count |
|---|---:|
| Unused files | 266 |
| Unused exports | 198 |
| Unused exported types | 203 |
| Unused dependencies | 25 |
| Unused devDependencies | 5 |

**knip over-reports — do not treat 266 as 266 deletable files.** Confirmed false positives in this run:

- **Hexagonal-migration barrels** staged but not yet consumed: `src/core/index.ts`, `src/core/entities/index.ts`, `src/core/use-cases/index.ts`, `src/infrastructure/index.ts` (+ `api/`, `auth/`, `db/` sub-barrels), `src/desktop/index.ts`. These are the in-progress `core/` + `infrastructure/` layer documented in `CLAUDE.md` — scaffolding for the native-migration foundation (I.2), not dead code.
- **Feature barrels / entry points** knip can't trace through lazy `React.lazy()` route loading or dynamic composition: e.g. `src/features/today/index.ts`, `src/features/today/TodayScreen.tsx`, `src/features/today/QuickScanCard.tsx`.
- **Test entry files** invoked by dedicated runners rather than the default vitest include (e.g. `server/tests/security.test.ts`, `server/tests/shift-chat.test.ts`) — see the excluded-test groups in `CLAUDE.md`.

The genuinely-actionable subset of knip's output is the intersection of *(unused per knip)* ∧ *(`delete-candidate` or `uncertain` per Lens 1)* ∧ *(no reachability chain per II.2)*. Computing that intersection per surface is a **per-phase clean-sub-phase task**, not a Phase 0 action.

Full knip output is reproducible with `pnpm knip`; the raw log for this baseline run is retained at `docs/audit/` review time (not committed — regenerate on demand).

## Reconciliation & standing rules

- **Report-only in Phase 0.** No file is deleted, moved, or rewritten by this document.
- **Reachability before reliance (II.2).** Before any later phase builds on an existing file, it re-verifies the real chain: route registered in `src/app/routes.tsx`? reachable from a nav model / in-app link? API fn called from a mounted component? server route in `server/app/routes.ts`? worker in `start-schedulers.ts`? An unreachable flow is an idea, never a contract to preserve.
- **Deletion path (III.7).** The ONE sanctioned deletion path is a phase's closing `chore: clean phase <n>` commit, each removal cross-checked with `knip` + reference grep + green `typecheck`/`test`, with out-of-fence candidates reported to the owner.
- **This file is living.** Each clean sub-phase updates the counts here so the clutter shrinks measurably across the program instead of being rediscovered per phase.

## Baseline gate snapshot (this branch, pre-change)

Recorded in `PROOF_ALIGNMENT_LOG.md` (2026-07-06 Phase 0 entry): `typecheck` ✅, `test` ✅ (405 files / 3949 tests), `i18n:check` ✅, `architecture:gates` ✅ (0 cycles). Native-sim + Playwright suites are environment-gated (require Xcode/booted simulator + running app) and were not run in this session — flagged for the live-walk follow-up.
