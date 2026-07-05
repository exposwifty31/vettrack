# Origin reconciliation report — 2026-07-05

Read-only analysis (`git fetch --prune` + `gh pr list`; nothing merged, deleted, or pushed).
Follow-up to the wet-check audit's "Origin hygiene" recommendation.

## Headline

- **The audit's four `cursor/*` bugfix branches are resolved.** Three were deleted upstream since the audit ran (`equipment-refetch-invalidation-a771`, `hero-kpi-scope-mixing-64c3`, `ipad-scan-query-not-forwarded-86d1`; `alerts-dropdown-acknowledged-counts-500f` was already gone). Their fixes are in `origin/main`: `57423a3d7` (refetch invalidation), `4b2beed02` (alerts-dropdown parity + iPad scan forward). Hero-KPI scope mixing maps to `9f689394f` ("kill false 0% KPI…"), already in main — worth a quick visual check that the specific scope-mixing symptom is gone, since the branch can no longer be diffed.
- **`origin/main` now includes the two Bugbot review fixes** the audit saw as "3 commits ahead" on the session branch — that reconciliation already happened (the `claude/refine-local-plan-jjrebb` branch is gone upstream).
- **Local `main` is 6 commits ahead of `origin/main`, 0 behind** — the CLAUDE.md drift-fix docs commit plus the five wet-check fix commits from 2026-07-05 (`c8b567279` P0 quick-scan gates, `7b77e8865` P1 body-parser, `7a6433870` F3 shift CSV, `df75789c3` F4 waitlist, `ad1147c16` RFID teardown + purge tool). ⚠️ **Pushing `main` triggers the CI deploy to Railway production** — push deliberately, not casually.

## Open PRs (16)

### Real work — decide and move
| PR | Branch | State | Note |
|---|---|---|---|
| #40 | `chore/relevance-audit-cleanup` | 10 ahead / 29 behind, active 2026-07-03 | Dead-code removal from the relevance audit. Rebase + land while it's fresh — it rots fastest. |
| #36 | `feat/design-handoff-s1-s3` | 8 ahead / 70 behind, 2026-07-01 | Stage-1 design tokens. Overlaps the design-stages implementation track; decide whether it's superseded before rebasing 70 commits. |

### Docs-only forensic-audit PRs — cheap to clear
#26, #27, #28, #29 (`claude/*`, 1 commit each, docs only, late June). Merge or close as historical; they don't touch code.

### Dependabot (10)
| PR | Bump | Risk note |
|---|---|---|
| #12 | `@clerk/express` 1.7.77 → **2.1.35 (major)** | **Do not auto-merge.** Auth middleware surface; the repo has prior Clerk-upgrade scar tissue (native `<SignIn>` breakage on a Clerk major). Needs `pnpm auth:preflight` + dev-bypass and clerk-mode smoke tests. |
| #13 | `@sentry/node` 10.48 → 10.63 | Minor; low risk. |
| #10 | `express-rate-limit` 8.3.2 → 8.5.2 | Patch/minor; low risk. |
| #11, #14 | Radix popover / alert-dialog 1.1.15 → 1.1.18 | Patch; low risk. |
| #6–#9, #8 | GH Actions majors (checkout 4→7, setup-node 4→6, upload-artifact 4→7, download-artifact 4→8, pnpm/action-setup 4→6) | Majors of artifact actions have breaking config changes; batch them in one CI-only PR and watch one full CI run (CI deploys production on main!). |

### Leftover trivia
- `cursor/setup-dev-environment-2cbf` — single docs commit (`AGENTS.md` Cloud-VM caveats, 8 lines). Merge or close; no PR exists for it.

## Fully merged / deletable upstream
- `feat/legal-pages-privacy-terms-support` — **0 ahead** of origin/main; branch can be deleted.

## Local branch hygiene (this machine)
Branches whose upstream is **gone** (merged long ago): `exposwifty31-patch-1`, `feat/P1-S2-feature-today`, `feat/P1-S3-feature-equipment-list`, `feat/P1-S7-equipment-inference`, `feat/P2-S1-infrastructure-adapters`, `feat/design-stages-implementation`. Plus stale local-only starts at old commits: `feat/P1-S4/S5/S6-*`, `chore/design-sync-conventions-refresh`. Candidates for `git branch -d` after a quick glance; not deleted here.

## Untracked wet-check tooling
`scripts/wetcheck/` is still untracked except `prepare-real-db.ts` (committed with its fix in `ad1147c16`). Decide whether `seed.ts` / `simulate.mjs` / `cleanup.ts` / the CSV + results files should be committed or removed.

## Suggested order of operations
1. Push local `main` when you're ready for a production deploy (6 commits, all test-gated).
2. Land #40 (relevance cleanup) before it drifts further.
3. Clear docs PRs #26–#29 and the `cursor/setup-dev-environment` docs commit in one sweep.
4. Batch the GH-Actions bumps; take the low-risk npm bumps (#10, #11, #13, #14); schedule the Clerk major (#12) as its own tested change.
5. Decide #36 vs the design-stages track; delete `feat/legal-pages-privacy-terms-support`.
