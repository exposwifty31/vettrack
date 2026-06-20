# VetTrack — Repository Cleanup Manifest

**Generated:** 2026-06-20  
**Production anchor:** iOS `MARKETING_VERSION=1.0.1`, `CURRENT_PROJECT_VERSION=20`; locales `whatsNew.currentVersion=1.0.1`, `buildLabel=Build 20`  
**Product scope:** [`docs/scope-change-2026.md`](../scope-change-2026.md) (migrations 142–143)  
**Ship lane:** `/Users/dan/vettrack-ship` → `main` (do not modify)  
**Dev lane:** `/Users/dan/vettrack` → `main-sync`  
**Remotes:** `origin` → `github.com/exposwifty31/vettrack` (canonical); `gitlab` → `gitlab.com/dboy31561/vettrack` (secondary mirror)

---

## Summary

| Action | Count / status |
|--------|----------------|
| **ARCHIVE** (moved this cleanup) | `attached_assets/` → `docs/archive/2026/attached_assets/`; `gan-harness/` → `docs/archive/2026/gan-harness/` |
| **UPDATE** (doc fixes this cleanup) | 7 primary docs + 2 runbook/CONTRIBUTING touch-ups |
| **KEEP** | Runtime code, governance drafts, completed agent plans |
| **DELETE** | Pruned 5 stale git worktree registrations (dirs already absent) |
| **DEFER** (human approval) | 7 local branches with unmerged commits; GitLab remote branches |

---

## Phase A — Directory inventory

### `attached_assets/` (85 files: ~55 prompt dumps + screenshots)

| Verdict | Reason |
|---------|--------|
| **ARCHIVE** → `docs/archive/2026/attached_assets/` | Replit/Cursor prompt paste dumps and one-off screenshots. Not referenced by runtime, CI, or canonical ops docs. Historical agent context only. |

### `gan-harness/` (6 files)

| Verdict | Reason |
|---------|--------|
| **ARCHIVE** → `docs/archive/2026/gan-harness/` | GAN harness experiment (`spec.md`, `eval-rubric.md`, feedback). No runtime consumer; not wired to CI. |

### `docs/governance/` (10 files)

| File | Verdict | Notes |
|------|---------|-------|
| `PRODUCT_MODEL.md` | **KEEP** | Canonical product model post scope-change |
| `ARCHITECTURE_MAP.md` | **KEEP** | Architecture inventory |
| `PRODUCT_ALIGNMENT_REPORT.md` | **KEEP** | June 2026 alignment audit — still valid |
| `GITHUB_GOVERNANCE.md` | **KEEP** | Documents GitHub/GitLab divergence; index from `docs/README.md` |
| `CI_CD_GOVERNANCE.md` | **UPDATE** | References deleted `.gitlab-ci.yml`; update after GitHub-first migration |
| `ENGINEERING_FRICTION_REPORT.md` | **KEEP** | Friction inventory; dual-CI note is historical context |
| `FROZEN_SURFACE_CHANGE_PROTOCOL.md` | **KEEP** | Frozen surface change protocol |
| `LITERATE_DOLLOP_PARITY_REPORT.md` | **KEEP** | Expo/RN parity tracking |
| `EXPO_AGENT_BRIEF.md` | **KEEP** | Mobile strategy brief |
| `PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md` | **UPDATE** | References `.gitlab-ci.yml` architecture gate — stale |
| `REPO_CLEANUP_MANIFEST.md` | **KEEP** | This file |

### `.claude/PRPs/plans/completed/` (3 files)

| File | Verdict | Reason |
|------|---------|--------|
| `docs-scripts-renewal.plan.md` | **KEEP** | Completed agent plan; low cost to retain |
| `align-native-version-banner.plan.md` | **KEEP** | Completed |
| `vettrack-ux-redesign.plan.md` | **KEEP** | Completed |

### `.claude/worktrees/` (5 prunable registrations)

| Worktree branch | Verdict | Reason |
|-----------------|---------|--------|
| `worktree-agent-a63f5345e96556660` | **DELETE** (prune) | Prunable; dir absent; no unique commits vs `main-sync` |
| `worktree-agent-ab2d8e6d8ae7d8ebe` | **DELETE** (prune) | Same |
| `worktree-agent-abab1ecbddd7ba583` | **DELETE** (prune) | Same |
| `worktree-agent-abb3a58da1f320114` | **DELETE** (prune) | Same |
| `claude/mystifying-tu-e903fe` | **DELETE** (prune) | Same |

---

## Stale documentation

| Path | Verdict | What's wrong |
|------|---------|--------------|
| `docs/mobile/store-metadata.md` | **UPDATE** ✅ | Medication tasks, ER module, billing claims, `/appointments` paths — removed in scope-change |
| `docs/MAINTENANCE_MODE.md` | **UPDATE** ✅ | Build 15; GitLab as `origin`; forbids GitHub remote |
| `docs/README.md` | **UPDATE** ✅ | Missing governance index; GitLab CI as primary devops link |
| `docs/setup/environment.md` | **UPDATE** ✅ | GitLab-only clone; GitLab CI variables section |
| `docs/GITLAB_DEVELOPMENT.md` | **UPDATE** ✅ | Declares GitLab primary; references `.gitlab-ci.yml` |
| `docs/devops/ci-cd.md` | **UPDATE** ✅ | Dual CI; `.gitlab-ci.yml` deleted in `f927e5b1` |
| `docs/runbooks/inventory-jobs-failed-deductions.md` | **UPDATE** ✅ | Medication inventory jobs — feature removed (migration 143) |
| `CONTRIBUTING.md` | **UPDATE** ✅ | Async inventory skew section references live medication deduction worker |
| `docs/validation/phase-10-stabilization-report.md` | **ARCHIVE** (defer move) | May 2026 snapshot; pre-scope-change context — keep in place, add scope banner optional |
| `docs/program-brain/pilot-mode-decommission-inventory.md` | **KEEP** | Pilot mode deleted; inventory doc is historical decommission record |
| `docs/investor-deck/` | **KEEP** | Marketing assets; review copy for removed features separately |

---

## Runtime & canonical ops (KEEP — do not archive)

| Area | Key paths |
|------|-----------|
| Application | `src/`, `server/`, `shared/`, `locales/` |
| Schema | `server/schema/`, `migrations/` |
| CI (active) | `.github/workflows/` |
| Mobile ship | `ios/`, `android/`, `capacitor.config.ts`, `docs/mobile/README.md` |
| Ops runbooks (live) | `docs/runbooks/` (except medication inventory jobs — deprecated) |
| Architecture frozen | `docs/architecture/offline-realtime-invariants.md`, `CLAUDE.md` |
| Scope truth | `docs/scope-change-2026.md`, `PLAN.md`, `TASKS.md` |
| Dev setup (canonical) | `docs/devops/github-setup.md`, `docs/setup/environment.md` |

---

## Git branches & worktrees

### Worktrees (observed 2026-06-20)

| Path | Branch | Status |
|------|--------|--------|
| `/Users/dan/vettrack` | `main-sync` | Active dev lane |
| `/Users/dan/vettrack-ship` | `main` | Ship lane — **do not touch** |
| `.claude/worktrees/*` (5) | agent branches | **Pruned** this cleanup |

### Local branches — DEFER deletion (unmerged commits)

| Branch | Merged to `main-sync`? | Notes |
|--------|------------------------|-------|
| `exposwifty31-patch-1` | No | Dependabot/security allow-list fixes |
| `feat/native-migration-phases-1-3` | No | Native migration + CI fixes |
| `fix/coderabbit-account-deletion` | No | Account deletion + CI |
| `fix/desktop-responsive-layout` | No | iOS icons + responsive layout |
| `fix/ui-token-test-z-index` | No | Playwright/token test fixes |
| `transformation/vnext` | No | CodeRabbit config experiments |
| `transformation/vnext-coderabbit-fresh` | No | Audit remediation branch |

**Safe to delete after review:** `worktree-agent-*` local branch refs (if still present after prune).

### Local branches — likely safe (merged or empty vs `main-sync`)

| Branch | Notes |
|--------|-------|
| `feat/clinical-design-system-refresh` | No unique commits vs `main-sync` |
| `feat/legal-pages-privacy-terms-support` | No unique commits vs `main-sync` |
| `feat/ux-redesign-equipment-first` | No unique commits vs `main-sync` |
| `claude/mystifying-tu-e903fe` | Worktree pruned; verify branch ref |

### Remote branches (DEFER — list only)

**`origin`:** `main`, dependabot branches, `feat/legal-pages-privacy-terms-support`  
**`gitlab`:** 14 remote branches including stale `main` (71 commits behind GitHub per `GITHUB_GOVERNANCE.md`)

---

## Phase C actions taken

1. `git worktree prune` — removed 5 prunable worktree registrations  
2. `git mv attached_assets docs/archive/2026/attached_assets`  
3. `git mv gan-harness docs/archive/2026/gan-harness`  

## Phase C actions NOT taken (by design)

- No local branch deletion  
- No force-push  
- No changes under `/Users/dan/vettrack-ship`  
- No database migrations  

---

## Recommended next steps

### Commit (when approved)

```
chore(docs): repo cleanup manifest, archive agent artifacts, align docs to 1.0.1

- Add docs/governance/REPO_CLEANUP_MANIFEST.md
- Archive attached_assets/ and gan-harness/ under docs/archive/2026/
- Align store metadata, MAINTENANCE_MODE, environment setup to GitHub-first + scope-change 2026
- Prune stale agent worktree registrations
```

### Branch cleanup (human approval)

```bash
# After confirming branches are obsolete or merged via MR:
git branch -d feat/clinical-design-system-refresh feat/legal-pages-privacy-terms-support feat/ux-redesign-equipment-first

# Unmerged — review diff first:
git log main-sync..feat/native-migration-phases-1-3 --oneline
# git branch -D <branch>   # only after explicit approval
```

### Follow-up (manifest UPDATE deferred)

- Refresh `docs/governance/CI_CD_GOVERNANCE.md` and `PRODUCT_DRIVEN_IMPROVEMENT_PLAN.md` GitLab CI references  
- Review `docs/investor-deck/` copy for removed medication/ER features  
- Sync or archive `gitlab/main` once migration complete  

---

## Blockers

None for this cleanup pass. GitHub branch protection and labels still require manual steps in [`docs/devops/github-setup.md`](../devops/github-setup.md).
