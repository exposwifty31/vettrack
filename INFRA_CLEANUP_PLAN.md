# VetTrack — Section B: GitHub + Railway Infrastructure Audit

**Generated:** 2026-05-21  
**Audit branch:** `cursor/infra-cleanup-audit-6f27` (from `staging`)  
**Scope:** Read-only audit — **no** changes to GitHub, Railway, Clerk, databases, env vars, workflows, or application code.  
**Method:** `gh` API/CLI, `git` remote inspection, live HTTP probes to deployed hosts. Railway CLI/dashboard not available in this environment.

---

## Executive summary

| Area | Finding | Risk |
|------|---------|------|
| Branch topology | **279** remote branches; **176** `cursor/*` + `claude/*`; **40** agent branches already merged into `main` | Medium (noise, mistaken deploys) |
| `main` ↔ `staging` | **Diverged** (7 commits ahead / 7 behind each other) | Medium (release drift) |
| Workflows | **6** active on `main`; `workday-simulation-nightly.yml` exists only on `staging` | Medium (nightly job never runs until merged) |
| Open PRs | **4** open to `main` (#355 green; #308/#283 stale; #358 draft + conflicts) | Low–medium |
| Branch protection | GitHub API **403**; rulesets API returns `[]` | Medium (unknown enforcement) |
| Railway live | Prod + staging **reachable**; `healthz`/`startup` **200**; readiness **503 degraded** (`worker: fail`) on both | Medium (queue/worker parity) |
| Env drift | Staging reports `nodeEnv: "production"` on startup probe; Clerk key **prefixes not exposed** via HTTP | Low–high (dashboard-only vars) |

---

## 1. Branch audit

### Counts (2026-05-21, `gh api …/branches`)

| Prefix / branch | Count | Notes |
|-----------------|------:|-------|
| `claude/*` | 116 | Agent feature branches |
| `cursor/*` | 60 | Cursor agent branches |
| `feat/*` | 32 | Feature work |
| `fix/*` | 20 | Fixes |
| `codex/*` | 17 | Codex agent branches |
| `railway/*` | 4 | Infra experiments |
| `main` | 1 | Default branch; production deploy target |
| `staging` | 1 | Staging Railway + manual E2E gate |
| Other (`chore/*`, `phase-*`, `Saas---Phase-0`, …) | 28 | Long-lived / legacy |

**Total remote branches:** 279

### Merge status vs `origin/main`

| Metric | Value |
|--------|------:|
| Branches merged into `main` | 100 |
| Merged `cursor/*` or `claude/*` | 40 |
| Unmerged `cursor/*` + `claude/*` (sampled) | 136+ |

### `main` vs `staging`

| Check | Result |
|-------|--------|
| Last `staging` commit | 2026-05-21T07:28:27Z |
| Compare `main...staging` | **diverged**, **7 ahead / 7 behind** |
| Workflow/doc delta on `staging` only | `workday-simulation-nightly.yml`, `docs/release-runbook.md`, `docs/staging-e2e-runbook.md`, `docs/playwright-matrix.md`, workflow tweaks |

**Finding:** Staging carries release/staging runbooks and the workday nightly workflow that are not yet on `main`. Plan a controlled `staging → main` merge after green staging E2E, not ad-hoc branch deletes.

---

## 2. Workflow audit

### Workflows on default branch (`main`) — via `gh workflow list`

| Workflow | File | Trigger | Concurrency | Audit |
|----------|------|---------|-------------|-------|
| CI — VetTrack | `ci.yml` | `pull_request` (all bases), `push` → `main` | ✅ per-ref | **Keep** — canonical tsc + vitest + build |
| Playwright Tests | `playwright.yml` | PR + `push` → `main` | ✅ | **Keep** — waits on `/api/healthz`; uses `test:playwright:chromium` |
| Release Gate | `release-gate.yml` | `push` → `main`, `workflow_dispatch` | ✅ global | **Investigate** — overlaps CI gates |
| Flake Detection | `flake-detection.yml` | cron `0 3 * * *`, dispatch | ✅ | **Keep** — nightly vitest only |
| Staging E2E (manual) | `staging-e2e-manual.yml` | `workflow_dispatch` only | ✅ | **Keep** — branch guard refuses non-`staging` ref |
| Desktop cleaner | `desktop-cleaner-release.yml` | release | — | **Keep** — separate product |
| Workday simulation | `workday-simulation-nightly.yml` | — | — | **Not on `main`** — file only on `staging` |

### Workflows only on `staging` (not default branch)

| Workflow | Issue |
|----------|-------|
| `workday-simulation-nightly.yml` | Cron runs on repo **default branch** (`main`). Job `if: github.ref == 'refs/heads/staging'` → scheduled runs on `main` **skip the job**. Nightly workday is **inactive** until merged to `main` **and** `if` fixed (e.g. `workflow_dispatch` on `staging` only, or `branches: [staging]` schedule pattern). |

### Trigger / safety findings

| Finding | Evidence | Risk | Action |
|---------|----------|------|--------|
| CI does not run on `push` to `staging` | `ci.yml` `push.branches: [main]` only | Medium | **Investigate** — add `staging` push or require PRs into `staging` |
| Playwright same as CI | `playwright.yml` → `main` only | Medium | **Keep** on `main`; staging uses manual workflow |
| Staging E2E secrets | `DATABASE_URL_STAGING`, `CLERK_*_STAGING`, `TEST_BASE_URL_STAGING` | High if wrong | **Keep** guards in `scripts/staging/guard.ts` |
| Optional Railway deploy in CI | `vars.RAILWAY_USE_CLI_DEPLOY == 'true'` | Low | **Investigate** — confirm var false in prod automation |
| `staging:seed` absent on `main` | `git show origin/main:package.json` has no `staging:*` scripts | Medium | **Merge** staging tooling to `main` **or** document that dispatch must use `staging` ref (workflow already checks out dispatch ref) |
| Playwright scope (staging branch) | `playwright.config.ts` ignores `example.spec.ts`, `staging-*.spec.ts` | Low | **Keep** on `staging`; **Merge** to `main` via #358 / staging merge |
| Flake matrix regression on `staging` | `flake-detection.yml` on `staging` hardcodes 3 runs; `main` has dynamic `repeat_count` | Low | **Merge** prefer `main` version when reconciling branches |

### Playwright specs in repo (reference)

| Spec | CI default (`playwright.config.ts`) | Staging config |
|------|-------------------------------------|----------------|
| `tests/example.spec.ts` | Ignored | — |
| `tests/staging-*.spec.ts` | Ignored | Used via `playwright.staging.config.ts` |
| `tests/signup-flow.spec.ts` | Included in CI match | — |
| `tests/ui-smoke.spec.ts` | Included | — |
| `tests/phase-9-drills.spec.ts` | Included (heavy) | — |
| `tests/e2e/simulation/workday.spec.ts` | Included in default match | Intended for workday nightly |

---

## 3. Open pull request audit (2026-05-21)

| # | Title | Base | Head | Updated | Checks | Classification |
|---|-------|------|------|---------|--------|----------------|
| 358 | Playwright scope hardening (draft) | `main` | `cursor/playwright-scope-hardening-bc2f` | 2026-05-21 | None reported | **Investigate** — CONFLICTING, draft |
| 355 | fix(qr-scanner): scan-line animation | `main` | `cursor/qr-scan-line-animation-fix-b4d9` | 2026-05-21 | CI + Playwright **pass** | **Merge** when reviewed |
| 308 | P1 clinic-scope PO reads | `main` | `claude/p1-fetch-without-clinic-fix` | 2026-05-14 | Last run **pass** (stale) | **Investigate** — rebase + re-run checks |
| 283 | docs: Phase 0 authority documents | `main` | `claude/audit-app-codebase-irCU6` | 2026-05-13 | **pass** | **Investigate** — close or merge (8d idle) |

**Open PRs targeting `staging`:** 0

**Recent merges (context):** #357 QA stabilization, #356 staging walkthrough, #354 release runbook, #352–353 staging E2E workflow — landed 2026-05-21.

---

## 4. Branch protection audit

| Check | API result | Expected (runbook) |
|-------|------------|-------------------|
| `GET …/branches/main/protection` | **403** Resource not accessible by integration | Required status checks: CI, Playwright, merge gate |
| `GET …/branches/staging/protection` | **403** | CI on PRs; no direct push |
| `GET …/rulesets` | `[]` (empty) | May use classic rules or org-level rules |

**Action:** **Investigate** — repository admin exports branch protection / rulesets screenshot or API token with `admin:repo_hook` into `docs/infra/branch-protection.md` (read-only doc; no settings changes in this audit).

---

## 5. Railway environment topology

### Documented model (repo + runbooks)

| Environment | URL | Git branch | Clerk (expected) |
|-------------|-----|------------|------------------|
| **Production** | `https://vettrack.uk` | `main` | `pk_live_*` / `sk_live_*` |
| **Staging** | `https://vettrack-staging.up.railway.app` | `staging` | `pk_test_*` / `sk_test_*` |

### Repo-visible deploy config (`railway.json`)

| Setting | Value |
|---------|--------|
| Builder | NIXPACKS |
| Build | `NODE_ENV=development pnpm install --frozen-lockfile` + `pnpm build` with `VITE_CLERK_PUBLISHABLE_KEY` |
| Start | `pnpm start` → `tsx server/index.ts` |

### Live HTTP probes (read-only, 2026-05-21)

| Path | Production | Staging | Notes |
|------|:----------:|:-------:|-------|
| `GET /api/healthz` | **200** (0.13s) | **200** (0.04s) | Liveness — `server/index.ts` |
| `GET /api/health/startup` | **200** | **200** | Both report `nodeEnv: "production"`, DB reachable, Redis + Clerk configured |
| `GET /api/health` (readiness) | **503** degraded | **503** degraded | `db/clerk/vapid: ok`, **`worker: fail`** |
| `GET /api/health/ready` | **503** degraded | **503** degraded | Same router mount as readiness |

**Finding:** Railway likely sets `NODE_ENV=production` for both services (common PaaS pattern). Staging **must** still use **test** Clerk keys via dashboard vars — enforced at runtime by `scripts/staging/guard.ts` for E2E, not by `NODE_ENV`.

### Services / plugins / domains (dashboard — not enumerable here)

| Component | Production | Staging | Audit action |
|-----------|------------|---------|--------------|
| App service | ✅ assumed | ✅ assumed | **Investigate** — instance count, region |
| PostgreSQL | Separate | Separate | **Investigate** — confirm `DATABASE_URL_*` never cross-wired |
| Redis | Required in prod (`envValidation`) | Present per startup probe | **Investigate** — worker heartbeat failing on **both** envs |
| Custom domain | `vettrack.uk` | `*.up.railway.app` | **Keep** |
| Plugins (if any) | Unknown | Unknown | **Investigate** in Railway UI |
| Env var parity | Unknown | Unknown | **Investigate** — redacted export diff |

**Worker heartbeat:** Readiness checks Redis key `vettrack:worker:heartbeat` (see `server/routes/health.ts`). **503 on both prod and staging** suggests BullMQ/notification worker not heartbeating or Redis key missing — operational follow-up, not a repo change.

### CI ↔ Railway integration (from `ci.yml`)

| Secret / var | Purpose |
|--------------|---------|
| `RAILWAY_TOKEN`, `RAILWAY_SERVICE` | CLI deploy when enabled |
| `vars.RAILWAY_USE_CLI_DEPLOY` | Gate — deploy jobs **skipped** when not `true` |
| Production secrets | `DATABASE_URL`, `REDIS_URL`, `CLERK_*`, `ALLOWED_ORIGIN`, `DB_CONFIG_ENCRYPTION_KEY` |

**Finding:** Deploy jobs are **skipped** in observed PR runs — GitHub→Railway deploy is likely **Railway Git integration**, not Actions CLI.

---

## 6. Staging vs production drift

| Dimension | Source of truth | Observed | Action |
|-----------|-----------------|----------|--------|
| Git ref | Railway service settings | Prod ← `main`, staging ← `staging` (documented) | **Investigate** dashboard |
| `NODE_ENV` | Railway / platform | Both startup probes: `"production"` | **Keep** if intentional; document |
| Clerk keys | Railway secrets | Not exposed over HTTP | **Investigate** redacted var diff |
| Build/start | `railway.json` | Same file in repo | **Keep** |
| Health paths | Code | `healthz` + `/api/health/*` | **Keep** — align Railway health check path with `healthz` or `startup` |
| Readiness worker | Live probe | Degraded both envs | **Investigate** Redis + worker scheduler |
| GitHub workflows | Branch | 4 files differ `main`↔`staging` | **Merge** after E2E |
| `package.json` staging scripts | Branch | On `staging`, absent on `main` | **Merge** or document dispatch ref rule |

### Code-enforced safety (repo)

| Check | Status |
|-------|--------|
| `validateEnv()` blocks `sk_test`/`pk_live` mismatch | ✅ `server/lib/envValidation.ts` |
| Production requires `REDIS_URL`, live Clerk, encryption key | ✅ |
| `scripts/staging/guard.ts` blocks prod hosts / live Clerk for E2E | ✅ |
| Staging workflow uses `TEST_BASE_URL_STAGING`, not `vettrack.uk` | ✅ `staging-e2e-manual.yml` |

---

## 7. Consolidated action matrix (keep / merge / delete / investigate)

| Item | Keep | Merge | Delete | Investigate | Risk | Rollback | Validation |
|------|:----:|:-----:|:------:|:-----------:|------|----------|------------|
| `main`, `staging` branches | ✅ | | | | Low | N/A | Both deployable |
| Reconcile `staging` → `main` (7/7 diverged) | | ✅ | | | Medium | Revert merge commit | Staging E2E dispatch green |
| Prune **merged** `cursor/*` / `claude/*` remotes | | | ✅ | | Low | Restore from SHA | `git ls-remote` count drops |
| Prune **unmerged** agent branches | | | | ✅ | Medium | Restore from SHA | No open PR / no unique commits |
| `Saas---Phase-0`, old `phase-*` branches | | | | ✅ | Low | | Owner confirm |
| `ci.yml`, `flake-detection.yml`, `staging-e2e-manual.yml` | ✅ | | | | Low | Revert YAML | Green PR |
| `playwright.yml` safe allowlist | | ✅ | | | Medium | Revert YAML | Playwright job green |
| `workday-simulation-nightly.yml` to `main` + fix cron/`if` | | ✅ | | ✅ | Low | Disable workflow | Scheduled run hits staging URL |
| `release-gate.yml` vs `ci.yml` overlap | | | | ✅ | Low | Revert | Pilot release |
| Branch protection documentation | | | | ✅ | Medium | N/A | Admin export |
| Railway env redacted diff | | | | ✅ | High | Restore prior vars | Smoke `healthz` + staging E2E |
| Worker heartbeat / Redis on Railway | | | | ✅ | Medium | Redeploy / fix Redis | `/api/health` → `worker: ok` |
| Open PR #355 | | ✅ | | | Low | Revert | Review + merge |
| Open PR #308, #283 | | | | ✅ | Low | Close | Re-run checks or close |
| Open PR #358 | | | | ✅ | Medium | Close draft | Rebase, undraft, CI green |
| Delete Railway services | | | | | **Critical** | — | **Never without approval** |

---

## 8. Risks

| Risk | Description | Mitigation |
|------|-------------|------------|
| **Cross-env DB** | Wrong `DATABASE_URL` on staging E2E | `staging/guard.ts` + `DATABASE_URL_STAGING` secret review |
| **Clerk key mix** | `pk_live` on staging | Guard + dashboard audit; server exits on mismatch |
| **Branch delete** | Removing branch with unmerged work | Only delete after `git branch -r --merged` + no open PR |
| **Workflow merge** | Broken cron or wrong `TEST_BASE_URL` | Test `workflow_dispatch` on `staging` before merging to `main` |
| **Railway var edit** | Immediate redeploy / outage | Change staging first; export backup |
| **False confidence on health** | `healthz` 200 while readiness 503 | Use readiness for dependency alerts; fix worker heartbeat |
| **Protection unknown** | 403 on API may hide weak rules | Admin verification |

---

## 9. Rollback

| Change type (future ops) | Rollback |
|--------------------------|----------|
| Workflow YAML | Revert commit on `main` / `staging`; re-run workflows |
| Branch deletes | `git push origin <sha>:refs/heads/<name>` |
| Railway variables | Restore from Railway revision history / saved export |
| Clerk rotation | `docs/runbooks/1.4-clerk-key-rotation.md` |
| Merge `staging` → `main` | Revert merge commit; redeploy previous Railway deployment |

**This audit PR:** Only updates `INFRA_CLEANUP_PLAN.md` — rollback = revert the doc commit.

---

## 10. Deployment impact (this PR)

| Surface | Impact |
|---------|--------|
| Production (`vettrack.uk`) | **None** — documentation only |
| Staging Railway | **None** |
| GitHub settings | **None** |
| CI/CD | **None** |

---

## Appendix A — Audit commands (reproducible)

```bash
# Branches
gh api repos/dboy3156/VetTrack/branches --paginate -q '.[].name' | wc -l

# Open PRs
gh pr list --state open --json number,title,headRefName,mergeable,updatedAt

# main vs staging
gh api repos/dboy3156/VetTrack/compare/main...staging -q '.status,.ahead_by,.behind_by'

# Live health (read-only)
curl -sS -o /dev/null -w '%{http_code}\n' https://vettrack.uk/api/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://vettrack-staging.up.railway.app/api/healthz
```

---

## Appendix B — Health endpoint map (code)

| Path | Role | Implementation |
|------|------|----------------|
| `/api/healthz` | Liveness (always 200) | `server/index.ts` |
| `/api/health/startup` | Startup / config + DB ping | `server/routes/health.ts` |
| `/api/health`, `/api/health/ready` | Readiness (DB, Clerk, VAPID, worker) | `server/routes/health.ts` |

Recommended Railway health check: **`/api/healthz`** (simple) or **`/api/health/startup`** (DB-aware).
