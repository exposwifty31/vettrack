# VetTrack — GitHub & GitLab Governance Audit

**Phase:** 3 — GitHub Governance Audit  
**Generated:** 2026-06-18  
**Governor:** Product Engineering Governor  
**Prerequisites:** [`PRODUCT_MODEL.md`](./PRODUCT_MODEL.md), [`PRODUCT_ALIGNMENT_REPORT.md`](./PRODUCT_ALIGNMENT_REPORT.md)  
**Data sources:** `git remote -v`, `gh` CLI, `glab` CLI, repo templates, `docs/MAINTENANCE_MODE.md`, `docs/GITLAB_DEVELOPMENT.md`

---

## Platform reality (read first)

Documentation declares **GitLab** (`gitlab.com/dboy31561/vettrack`) as the canonical remote. **Local and GitHub state diverge from that policy.**

| Signal | Documented policy | Observed state (2026-06-18) | Severity |
|--------|-------------------|----------------------------|----------|
| Canonical remote | `origin` → GitLab (`MAINTENANCE_MODE.md`, `CONTRIBUTING.md`) | `origin` → **GitHub** `exposwifty31/vettrack`; `gitlab` → GitLab | **Critical** |
| `main` parity | Single release line | `origin/main` is **71 commits ahead** of `gitlab/main`; GitLab has **0** commits not on GitHub | **Critical** |
| CI merge gates | May be suspended; local verification contract | **GitHub Actions active** on recent pushes (green on `main`); GitLab pipeline status not verified live | **High** |
| Staging branch | Documented in `CONTRIBUTING.md` | **No `staging` remote branch** observed | **Medium** |

**Product impact:** Two truths for “what is main,” six open GitLab MRs against stale `gitlab/main`, and active GitHub delivery create **release confusion**, duplicate review effort, and risk shipping divergent artifacts (web + Capacitor + `@vettrack/contracts`).

---

## Branches

### Local & remote inventory

| Metric | Value |
|--------|-------|
| Total remote-tracking branches | ~36 |
| Local branches (non-worktree) | ~10 active + 4 `worktree-agent-*` |
| Merged into local `main` | ~14 |
| Not merged into local `main` | ~22 (feature + `cursor/*` + `transformation/*`) |

### Naming consistency

| Pattern | Compliance | Notes |
|---------|------------|-------|
| `feat/<topic>` | Good | e.g. `feat/legal-pages-privacy-terms-support` |
| `fix/<topic>` | Good | e.g. `fix/ci-phase-5-hardening` |
| `cursor/<topic>` | Good (GitLab CI rules) | Many agent branches from early June |
| `transformation/<topic>` | Present | Large program branches (`vnext`, `vnext-coderabbit-fresh`) |
| `claude/<topic>` | GitHub-only | e.g. `claude/apple-account-deletion-mhx6nx` |
| `worktree-agent-*` | Local only | Ephemeral agent worktrees — should not push |

**Policy reference:** `docs/GITLAB_DEVELOPMENT.md` branch table.

### Stale / merged / abandoned

| Branch / group | Last activity | Status | Severity | Recommendation |
|----------------|---------------|--------|----------|----------------|
| `gitlab/cursor/*` (8 branches) | 2026-06-02 – 06-06 | MRs merged or draft; remotes likely stale | **Medium** | Archive/delete remote after confirming merged |
| `gitlab/refactor/phase-2-ia-nav` | 2026-06-06 | Merged via !14 era; remote may linger | **Low** | Delete if merged |
| `gitlab/chore/gitlab-recovery-validation-test` | 2026-06-06 | Validation branch | **Low** | Delete |
| `transformation/vnext` | Open MR !17 | Long-running (~8+ days) | **High** | Merge, split, or close with decision |
| `feat/native-migration-phases-1-3` | Open MR !20 | Active native ship | **Important** | Prioritize review — store compliance |
| `fix/ui-token-test-z-index` | Open MR !19 | Small fix | **Low** | Quick merge or close |
| Local `fix/coderabbit-account-deletion`, `fix/desktop-responsive-layout` | Unknown | Not on either remote recently | **Low** | Push or delete local |

### `main` divergence (Critical)

```
origin/main  → 5a8eabd4 (2026-06-18)  GitHub
gitlab/main  → 085c5413 (2026-06-11)  GitLab  (−71 commits)
```

Recent GitHub-only commits include: iOS resubmission OAuth path, Capacitor SPM pin, legal pages merge, account deletion, CI phase-5 hardening.

**GitLab `main` has not received GitHub delivery for ~7 days.**

---

## Pull requests (GitHub)

**Repo:** `exposwifty31/vettrack` (public)

| Metric | Value |
|--------|-------|
| Open PRs | **0** |
| Merged PRs (total sampled) | **3** |
| `deleteBranchOnMerge` | **false** |
| Merge methods allowed | merge commit, squash, rebase |

### Merged PR history

| # | Title | Branch | Merged |
|---|-------|--------|--------|
| 3 | fix(ci): phase-5 hardening test + `isProductionRuntime()` | `fix/ci-phase-5-hardening` | 2026-06-18 |
| 2 | feat(legal): privacy, terms, support pages | `feat/legal-pages-privacy-terms-support` | 2026-06-17 |
| 1 | feat(account): in-app account deletion + Apple revocation | `claude/apple-account-deletion-mhx6nx` | 2026-06-17 |

### Long-running / stalled

None open. Historical PRs merged within 1–2 days — **healthy when GitHub is the active path**.

### Review hygiene

| Gap | Severity |
|-----|----------|
| No required reviewers (no branch protection) | **Critical** |
| No CODEOWNERS | **High** |
| PR template exists (`.github/pull_request_template.md`) — strong ADR/governance checklist | Positive |
| Source branches not auto-deleted after merge | **Medium** |

---

## Merge requests (GitLab)

**Project:** `dboy31561/vettrack`

| Metric | Value |
|--------|-------|
| Open MRs | **6** (3 draft, 3 non-draft) |
| Recent merged (sample) | !18, !16, !15, !14, !13, !11, !7, !6 |

### Open merge requests

| MR | Title | Source | State | Age signal | Severity |
|----|-------|--------|-------|------------|----------|
| !20 | Native store compliance + CI + docs (Phases 2–3, 7) | `feat/native-migration-phases-1-3` | Open | ~7 days | **High** — product ship path |
| !19 | fix(test): bottom-nav z-index assertion | `fix/ui-token-test-z-index` | Open | ~7 days | **Low** |
| !17 | Native mobile transformation / platform hardening | `transformation/vnext` | Open, 33 comments | ~8+ days | **High** — large blast radius |
| !10 | Draft: Cloud VM PostgreSQL gotchas docs | `cursor/cloud-dev-env-setup-8f19` | Draft | ~15 days | **Low** — close or merge |
| !9 | Draft: iOS native-feel finalization | `cursor/ios-native-feel-finalization-0a8c` | Draft | ~15 days | **Medium** — may overlap !20 |
| !8 | Draft: Final Visual QA harness | `cursor/final-visual-qa-harness-63ff` | Draft | ~15 days | **Low** |

### MR hygiene gaps

| Gap | Severity |
|-----|----------|
| **No labels** on open MRs | **Medium** |
| **No assignees / reviewers** on open MRs | **High** |
| MRs target **`gitlab/main`** which is **71 commits behind** GitHub | **Critical** |
| Duplicate/overlapping native work (!17 vs !20 vs !9) | **High** |
| MR template exists (`.gitlab/merge_request_templates/Default.md`) with GitHub sync note | Positive |
| Remote CI suspension (per `MAINTENANCE_MODE.md`) — MRs may lack gate signal | **High** |

---

## Issues

### GitHub

| Metric | Value |
|--------|-------|
| Issues enabled | Yes |
| Open issues | **0** |
| Issue templates | **None** (no `.github/ISSUE_TEMPLATE/`) |

### GitLab

`glab issue list` — not fully enumerated (auth intermittent for API). No evidence of structured issue-driven workflow in repo docs.

### Governance gap

| Gap | Severity |
|-----|----------|
| No issue templates on either platform | **Medium** |
| Zero open issues while 6 open MRs — work not tracked as issues | **Medium** |
| No milestone / project linkage visible on MRs | **Medium** |
| Backlog lives in `.cursor/plans/` and agent docs, not GitHub/GitLab Issues | **Low** (process choice, but hurts visibility) |

---

## Releases & tagging

| Platform | Releases | Tags | Release notes |
|----------|----------|------|---------------|
| GitHub | **None** published (`gh release list` empty) | Not audited | N/A |
| GitLab | Not enumerated | — | — |
| App store | iOS resubmission runbook exists | Version in native project | Human-driven (`RESUBMISSION_RUNBOOK.md`) |

| Gap | Severity |
|-----|----------|
| No GitHub/GitLab release artifacts for web deploys | **Medium** — Railway deploys from `main` commit, not tagged release |
| No changelog automation linked to tags | **Medium** |
| Manual **Release Gate** workflow exists (`.github/workflows/release-gate.yml`) — manual only | Positive |
| Semantic version / build tag (`__VT_BUILD_TAG__`) is build-time, not git tag | **Low** (by design for PWA) |

---

## Security

### Repository exposure

| Setting | GitHub (`exposwifty31/vettrack`) | Severity |
|---------|----------------------------------|----------|
| Visibility | **Public** | **High** — veterinary ops codebase; verify no secrets in history |
| Branch protection on `main` | **Not configured** (404) | **Critical** |
| `deleteBranchOnMerge` | false | **Medium** |
| Actions permissions | enabled, `allowed_actions: all`, SHA pinning not required | **Medium** |

### Dependabot & scanning

| Control | Status | Severity |
|---------|--------|----------|
| `.github/dependabot.yml` | **Absent** | **High** |
| Dependabot alerts (open) | API call failed / no config | **High** — enable |
| `CODEOWNERS` | **Absent** | **High** |
| `SECURITY.md` | **Absent** in repo root | **Medium** |
| Secret scanning | GitHub public repo default (assumed); not verified | — |
| Clerk webhook signature verification | Implemented (`server/routes/webhooks.ts`) | Positive |
| Integration webhook HMAC | Implemented | Positive |

### Branch protection checklist (both platforms — target state)

| Rule | GitHub | GitLab (expected) |
|------|--------|-------------------|
| Require PR/MR before merge to `main` | **Missing** | Verify in UI |
| Require status checks (CI, Playwright) | **Missing** | Per `GITLAB_DEVELOPMENT.md` when active |
| Require review | **Missing** | **Missing** on open MRs |
| Block force push | **Missing** | Verify |
| Require signed commits | Not required | Optional |

### Secrets & CI variables

Documented in `CONTRIBUTING.md` / `GITLAB_DEVELOPMENT.md`:

- `RAILWAY_USE_CLI_DEPLOY` — should stay **false** unless approved  
- `ANDROID_KEYSTORE_BASE64`, Clerk keys, `DB_CONFIG_ENCRYPTION_KEY` — mask in CI  
- **Risk:** public GitHub fork (`exposwifty31`) may expose Actions logs — review workflow secret usage

---

## Templates & process assets

| Asset | Location | Quality |
|-------|----------|---------|
| GitHub PR template | `.github/pull_request_template.md` | **Strong** — ADR triggers, G3–G5 governance, contracts gate |
| GitLab MR template | `.gitlab/merge_request_templates/Default.md` | **Good** — checklist, CI note, GitHub sync note |
| Issue templates | None | **Gap** |
| CONTRIBUTING.md | Root | Good; **contradicts** current `origin` remote |
| GITLAB_DEVELOPMENT.md | `docs/` | Good branch/MR policy |
| Conventional commits | Documented | Observed in recent history |

---

## CI/CD workflow inventory (GitHub Actions)

| Workflow | Trigger | Merge-blocking (when active) |
|----------|---------|------------------------------|
| `ci.yml` | PR/push `main`, `staging`, `cursor/**` | Yes (merge gate) |
| `playwright.yml` | PR/push `main`, `master`, `staging` | Yes |
| `release-gate.yml` | Manual | No |
| `flake-detection.yml` | Nightly | No |
| `e2e-simulation-nightly.yml` | Nightly | No |
| `workday-simulation-nightly.yml` | Nightly | No |
| `staging-e2e-manual.yml` | Manual on `staging` | No |

**Recent GitHub Actions (2026-06-18):** `main` push after PR #3 — **CI + Playwright success**. One prior `workflow_dispatch` failure on `main`.

**GitLab CI:** `.gitlab-ci.yml` mirrors GitHub stages; pipeline rules include `transformation/**` and `cursor/**`. Effectiveness depends on pipeline being enabled and `main` being current.

---

## Severity summary

| Area | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| Branches | 1 (`main` divergence) | 2 (stale program branches) | 3 | 4 |
| Pull requests / MRs | 1 (MRs vs stale base) | 4 (no reviewers, overlapping native MRs) | 3 | 2 |
| Issues | 0 | 0 | 3 | 1 |
| Releases | 0 | 0 | 3 | 1 |
| Security | 2 (no branch protection, public + ungated `main`) | 3 (no Dependabot, no CODEOWNERS) | 3 | 1 |

---

## Recommendations ranked by product ROI

### P0 — Restore single source of truth for delivery

1. **Pick one canonical remote and `main`** — either fast-forward `gitlab/main` from `origin/main` (71 commits) or declare GitHub canonical and update all docs/remotes to match.  
2. **Pause new GitLab MR merges** until base is reconciled — merging !17/!20 onto stale `gitlab/main` compounds divergence.  
3. **Enable branch protection** on canonical `main` (require CI + 1 review minimum).

### P1 — Review queue hygiene

4. **Triage open MRs:** merge !19 if green; decide !17 vs !20 vs draft !9 (consolidate native ship); close stale drafts !8, !10.  
5. **Add MR/PR labels** (`native`, `ci`, `docs`, `equipment`, `P0`) and assign reviewer.  
6. **Enable `deleteBranchOnMerge`** on GitHub; delete merged remote `cursor/*` branches.

### P2 — Security & compliance baselines

7. Add **`.github/dependabot.yml`** (npm + GitHub Actions).  
8. Add **`SECURITY.md`** with disclosure contact.  
9. Add **`CODEOWNERS`** for `server/`, `src/lib/api.ts`, `migrations/`, `.github/workflows/`.  
10. Consider **private** GitHub mirror or archive public fork if not intentional.

### P3 — Process polish

11. Add **issue templates** (bug, feature, ops).  
12. Link MRs to issues (`Closes #n`).  
13. Create **`staging`** branch or remove from CONTRIBUTING if abandoned.  
14. Align `git remote` naming: `origin` = canonical per docs.

---

## Authority actions (per governor skill)

**May do (after approval):** create labels, issues, improve templates, improve CODEOWNERS, document governance.

**Must not do without explicit approval:** delete branches, delete workflows, change branch protection, force-push `main`, reconcile remotes.

---

## Next phase

**Phase 4 — CI/CD Governance Audit** → `CI_CD_GOVERNANCE.md` (build reliability, workflow duplication, deploy safety, quality gates).
