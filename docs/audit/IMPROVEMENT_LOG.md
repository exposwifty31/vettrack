# Improvement Log (program III.5)

**Created:** 2026-07-07 · **Owner:** VetTrack program · **Status:** Living

Per [`docs/design/program-plan.md`](../design/program-plan.md) rule III.5, every phase surfaces improvements spotted while reading code — neither silently implemented when out-of-fence nor dropped. Owner routes each row: fold in (in-fence), queue, or reject.

Frozen surfaces may be *suggested about* here; execution requires an explicit unfreeze.

## Entry format

| Field | Meaning |
|-------|---------|
| **Evidence** | `file:line` or reproduced symptom |
| **Why real** | Cited source or repro steps |
| **Proposed change** | Concrete fix |
| **Benefit** | What improves |
| **Cost / risk** | Effort, regression risk |
| **Layer** | `engine` (broken capability) or `suspension` (polish) |
| **In-fence?** | Yes / No / N/A (report-only) |
| **Disposition** | `open` · `queued` · `folded` · `rejected` |

## Log

| ID | Date | Phase / surface | Evidence | Proposed change | Layer | In-fence? | Disposition |
|----|------|-----------------|----------|-----------------|-------|-----------|-------------|
| IMP-001 | 2026-07-07 | `docs/` hygiene | 7.9MB `docs/# VetTrack Design…Handoff.zip` duplicated `design-handoff/` | `git rm` zip; `docs/**/*.zip` in `.gitignore` | suspension | Yes | folded |
| IMP-002 | 2026-07-07 | `docs/` index | `docs/README.md` omitted program-plan, living audits, web console design | Expand README index | suspension | Yes | folded |
| IMP-003 | 2026-07-07 | Pre-143 audit docs | `strict-schema-audit.md`, `due-diligence-report.md` cite removed medication/ER APIs | Scope banners + pointer to `scope-change-2026.md` | engine | Yes | folded |
| IMP-004 | 2026-07-07 | Governance | `CI_CD_GOVERNANCE.md` still describes dual GitHub+GitLab CI | GitHub-first rewrite; GitLab historical | suspension | Yes | folded |

| IMP-005 | 2026-07-07 | Docs hygiene | GitLab remote/CI docs out of scope | Deleted `GITLAB_DEVELOPMENT.md`, `GITHUB_GOVERNANCE.md`, `.gitlab/`; scrubbed canonical docs | suspension | Yes | folded |

_Add new rows at the bottom. Do not delete folded rows — they are the program audit trail._
