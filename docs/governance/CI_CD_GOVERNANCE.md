# VetTrack — CI/CD Governance Audit

**Phase:** 4 — CI/CD Governance Audit  
**Generated:** 2026-06-18  
**Governor:** Product Engineering Governor  
**Prerequisites:** [`GITHUB_GOVERNANCE.md`](./GITHUB_GOVERNANCE.md), [`ARCHITECTURE_MAP.md`](./ARCHITECTURE_MAP.md)  
**References:** `docs/devops/ci-cd.md`, `.github/workflows/`, `.gitlab-ci.yml`, `deploy.sh`

---

## Executive summary

VetTrack has a **mature dual-platform CI design** (GitHub Actions + GitLab CI) with strong typecheck, vitest, architecture gates, and sharded Playwright. **GitHub is the active execution path** today; GitLab pipelines mirror GitHub but **`gitlab/main` is 71 commits behind** and may be suspended per `MAINTENANCE_MODE.md`.

| Dimension | Grade | Headline |
|-----------|-------|----------|
| Build reliability | **B+** | Recent `main` green; earlier failures on auth/native fixes |
| Merge gate strength | **B** | Solid when enabled; **not enforced** (no branch protection) |
| Pipeline duplication | **C+** ↑ | Two platforms + duplicate installs; ~~GitLab missing contracts gate~~ **contracts gate added 2026-06-18** |
| Deploy safety | **B** | Railway gated off by default; preflight script exists |
| Quality coverage gaps | **B-** ↑ | ~~No knip in PR lane~~ **knip non-blocking in both platforms (2026-06-18)**; i18n parity confirmed in merge gate; vitest excludes DB/live-server suites |
| Native/mobile CI | **D** | Manual scripts only; no iOS/Android in merge path |

---

## Build system

### Stack

| Layer | Tooling | CI entry |
|-------|---------|----------|
| Package manager | pnpm 9.15.9, frozen lockfile | All jobs |
| Node | 22.x (`.nvmrc`) | `setup-node` / `node:22-alpine` |
| Frontend build | Vite → `dist/public` | `pnpm build` |
| Server | `tsx` / compiled check via `tsconfig.server-check.json` | Dual `tsc` |
| DB | Postgres 16 service container | `pnpm migrate` → `scripts/run-migrations.ts` |
| E2E | Playwright Chromium, 2 shards | `pnpm test:playwright:ci` |

### Observed duration (GitHub, 2026-06-18, run `27743693070`)

| Job | Outcome | Approx. wall time |
|-----|---------|-----------------|
| **Total workflow** | success | **~3m 17s** (`run_duration_ms`: 197s) |
| Integration ops | success | ~2m (parallel) |
| Architecture gates | success | ~2m (parallel) |
| Tests & typecheck | success | ~3m (longest pole) |
| Playwright (per shard) | success | ~1m 54s – 2m 23s (separate workflow) |

**PR feedback time (typical):** ~3–5 minutes for CI + ~2–4 minutes Playwright (parallel workflows) → **~5–7 minutes** if both required.

### Reliability (recent `main` history)

| Run | Result | Notes |
|-----|--------|-------|
| PR #3 / `main` push | ✅ CI + Playwright | Phase-5 CSP hardening |
| `workflow_dispatch` on `main` | ❌ CI failure | Manual re-run — investigate if recurring |
| Native OAuth merge push | cancelled | Superseded by faster push |
| Auth Clerk session fix | ❌ CI then ✅ Playwright | Fixed in follow-up commit |
| Legal pages PR #2 | ✅ | |
| Account deletion PR #1 | ✅ | |

**Trend:** Failures cluster around **native/auth TypeScript** changes; core suite recovers quickly.

### Cache effectiveness

| Platform | Mechanism | Assessment |
|----------|-----------|------------|
| GitHub | `actions/setup-node` `cache: pnpm` keyed on lockfile | **Good** |
| GitLab | `.pnpm_cache` on `node_modules` + `.pnpm-store` | **Good** |
| Playwright browsers | Re-installed each run (`playwright install --with-deps`) | **Acceptable cost** (~30–60s) |
| Vite build | No cross-job build artifact reuse | **Opportunity** — GitLab chains build→test; GitHub rebuilds in Playwright |

### Parallelization

| Pattern | Status |
|---------|--------|
| `test` ∥ `integration-ops` ∥ `architecture-gates` (GitHub) | **Good** |
| GitLab `typecheck:frontend` ∥ `typecheck:server` → `build` → `test` | **Good staged DAG** |
| Playwright 2 shards, `fail-fast: false` | **Good** |
| Duplicate `pnpm install` + dual `tsc` in `test` and `architecture-gates` | **Medium waste** — acceptable for isolation |
| `concurrency: cancel-in-progress` per ref | **Good** — saves queue time |

---

## Workflows inventory

### GitHub Actions (8 files)

| Workflow | Trigger | Blocking? | Purpose |
|----------|---------|-----------|---------|
| `ci.yml` | PR/push `main`, `staging`; push `cursor/**`; manual | **Yes** (merge gate job) | tsc, build, migrate, vitest, integration-ops, architecture, optional Railway deploy |
| `playwright.yml` | PR/push `main`, `master`, `staging` | **De facto** (separate workflow) | 2-shard E2E against local API |
| `release-gate.yml` | Manual only | No | Pilot readiness: i18n parity, PWA, offline, a11y, extended tests |
| `flake-detection.yml` | Nightly 03:00 UTC; manual | No | Repeat vitest 2–5× |
| `workday-simulation-nightly.yml` | Nightly 04:00 UTC; manual | No | Staging URL workday suite |
| `e2e-simulation-nightly.yml` | Nightly 05:00 UTC; manual | No | Local simulation |
| `staging-e2e-manual.yml` | Manual on `staging` | No | Staging auth/Code Blue smoke |

### GitLab CI (`.gitlab-ci.yml`)

Mirrors GitHub with **more granular stages**: `typecheck` → `build` → `test` → `integration` → `architecture` → `deploy` → `playwright` + scheduled simulation stages.

| Job | GitHub equivalent | Drift? |
|-----|-------------------|--------|
| `typecheck:*` + `build:frontend` | Part of `test` job | GitLab more staged |
| `test:vitest` | `test` job | Aligned |
| `integration:ops` | `integration-ops` | Aligned |
| `architecture:gates` | `architecture-gates` | **Missing `contracts-gate.sh`** on GitLab |
| `ci:merge-gate` | `gate` job | Aligned (weaker — no script validation) |
| `playwright:shard-*` + `ci:playwright-gate` | `playwright.yml` | Aligned |
| `deploy:*` | `deploy-check` + `deploy` | Aligned; gated on `RAILWAY_USE_CLI_DEPLOY` |
| `android:build` (per open MR !20) | None | **Not on `main` branch file** — pending MR |

### Duplicate / dead / unused

| Issue | Severity | Detail |
|-------|----------|--------|
| **Dual platform maintenance** | **High** | Every CI change should touch both files; GitLab already drifted (contracts) |
| **Playwright not in `ci.yml` merge gate** | **High** | Two workflows must both pass; branch protection must list **both** |
| **`ci.yml` on `cursor/**` without Playwright** | **Medium** | Agent pushes get unit CI but **not** E2E unless PR opened to `main` |
| **`master` branch in Playwright only** | **Low** | Legacy branch name; harmless |
| **Stale `BuildFailed` workflow** | **Medium** | Documented in `TROUBLESHOOTING.md` — disable in GitHub UI if present |
| **Release-gate duplicates `ci.yml` tests** | **Low** | Intentional (manual, richer gates per DP-04 comment) |
| **Nightlies on default branch only** | **Low** | Correct — non-blocking observability |

### Workflow complexity

| Area | Assessment |
|------|------------|
| `ci.yml` merge gate `if: always()` + skip handling | **Well-designed** — deploy skip does not block |
| Deploy preflight secret guard | **Good** — missing secrets → skip, not fail |
| Playwright API boot + 60×2s health wait | **Robust**; logs uploaded on failure |
| GitLab `ci:merge-gate` | **Thin** — only echoes success; relies on `needs:` DAG |
| `.gitlab-ci.yml` length (~557 lines) | **High** — same concern as monolith routes |

---

## Deployment

### Production path

```
push main
  → (if vars.RAILWAY_USE_CLI_DEPLOY == 'true' AND secrets set)
      deploy.sh --check
      deploy.sh → railway cli up --service $RAILWAY_SERVICE --detach
  → else: skip (current default)
```

**Observed:** Deploy jobs **skipped** on 2026-06-18 `main` run — `RAILWAY_USE_CLI_DEPLOY` not enabled. Aligns with `CONTRIBUTING.md` ("leave disabled unless approved").

### Railway vs GitHub Actions

| Mode | Status |
|------|--------|
| Railway Git integration (push-to-deploy) | May run independently of Actions — **verify in Railway dashboard** |
| CLI deploy from CI | Opt-in via repo variable |
| Migrations | **`runMigrations()` at server boot** + `pnpm migrate` in CI — production applies on deploy start |

### Rollback capability

| Mechanism | Available? | Notes |
|-----------|------------|-------|
| Railway deployment history rollback | **Yes** (platform) | Operational — not automated in repo |
| Blue/green or canary | **No** | Single service deploy |
| DB migration rollback | **Manual** | Forward-only SQL migrations |
| PWA `__VT_BUILD_TAG__` | **Yes** | Client cache bust on new build |
| Feature flags / enforcement `shadow` | **Yes** | Per-clinic degrade paths |

### Environment protection

| Control | Status | Severity |
|---------|--------|----------|
| `RAILWAY_USE_CLI_DEPLOY` default off | **Good** | — |
| Production secrets in GitHub/GitLab CI vars | Expected | Masking required |
| No GitHub Environment gates (staging/prod) | **Gap** | **Medium** |
| `deploy.sh` blocks `PILOT_MODE` without `ALLOW_EQUIPMENT_PILOT_MODE` | **Good** | Prevents accidental pilot deploy |
| `pnpm validate:prod` | Local/script | **Not in merge gate** |

### Deployment bottlenecks

1. **Single-threaded `main` deploy** — no staging branch on remotes today.  
2. **Playwright + full CI before merge** — correct but slow for large MRs.  
3. **No automated smoke against production URL post-deploy** — workday nightly needs `TEST_BASE_URL_STAGING`.  
4. **Worker process split** — `notification.worker` not deployed via same `deploy.sh` path.

---

## Quality gates

### Merge-blocking (when CI active + branch protection configured)

| Gate | GitHub `ci.yml` | GitHub Playwright | GitLab | Local contract |
|------|-----------------|-------------------|--------|----------------|
| Frontend `tsc` | ✅ | — (build only) | ✅ | `npx tsc --noEmit` |
| Server `tsc` | ✅ | — | ✅ | `tsconfig.server-check.json` |
| `pnpm build` | ✅ | ✅ | ✅ | `pnpm build` |
| `pnpm migrate` + vitest | ✅ | ✅ (E2E path) | ✅ | `pnpm test` |
| `test:integration:ops` | ✅ | — | ✅ | Documented |
| `@vettrack/contracts` + emergency parity | ✅ | — | **❌ Missing** | `contracts-gate.sh` |
| dependency-cruiser | ✅ | — | ✅ | `architecture:gates` |
| madge cycle baseline | ✅ | — | ✅ | |
| tenant / query-key / route lint | Warn-only | — | Warn-only | |
| Playwright CI suite (2 shards) | Separate workflow | ✅ | ✅ | `pnpm test:playwright:ci` |

### Not in PR lane (gaps)

| Check | Where it runs | Product risk | Severity |
|-------|---------------|--------------|----------|
| **knip** (dead exports) | Local / agent rules only | Dead code accumulates | **High** |
| **i18n parity** (`check-parity.ts`) | `release-gate` manual; vitest `i18n-parity.test` in full test? | Broken HE/EN | **Medium** |
| **Dependabot / SCA** | Not configured | Vulnerable deps | **High** |
| **ESLint** | Not in CI | Style/consistency | **Low** (if no eslint project-wide) |
| **DB integration tests** | Excluded from default vitest | Migration/service regressions | **Medium** |
| **Live-server tests** | Excluded (`charge-alert`, `returns-api`, etc.) | Worker/API integration | **Medium** |
| **Native Capacitor build** | Manual scripts | Store submission regressions | **High** for mobile ship |
| **`validate:prod`** | Manual | Misconfigured prod env | **Medium** |
| **Phase 9 Playwright drills** | In CI suite when `PW_SUITE=ci` | Frozen surface regressions | Covered if CI green |

### Release gate (manual — `release-gate.yml`)

Richer than PR CI: i18n parity script, RTL foundation, mobile/PWA vitest groups, workflow integration tests, accessibility structure. **Correctly non-blocking** for daily merges; should run before pilot/demo/native store submission.

---

## GitHub vs GitLab CI drift register

| Item | GitHub | GitLab | Severity |
|------|--------|--------|----------|
| `contracts-gate.sh` | ✅ in architecture-gates | ❌ absent | **Critical** for mobile contract |
| `cursor/**` push triggers unit CI | ✅ | ✅ | Aligned |
| `transformation/**` branch rules | ❌ | ✅ | **Medium** — large MRs on GitLab only |
| Playwright on `cursor/**` | ❌ (no PR to main) | MR rules only | **Medium** |
| Active pipeline on current `main` | ✅ (71 commits ahead) | **Stale base** | **Critical** |
| Android `android:build` manual job | ❌ | In MR !20 only | **Medium** — native ship |

---

## Recommendations ranked by ROI

### P0 — Restore trust in the delivery pipeline

| # | Recommendation | Business impact | Engineering impact | Effort | ROI |
|---|----------------|-----------------|-------------------|--------|-----|
| 1 | **Reconcile `gitlab/main` with GitHub `main`** (or retire GitLab CI until needed) | Stops MR !17/!20 merging against false base | One-time sync + process | M | **Very high** |
| 2 | **Enable branch protection** requiring `CI — VetTrack` merge gate + both Playwright shards | Prevents broken `main` | GitHub settings | S | **Very high** |
| 3 | **Add `contracts-gate.sh` to GitLab `architecture:gates`** | Mobile/offline contract safety | 2-line script addition | XS | **High** |

### P1 — Close quality gaps without slowing every PR

| # | Recommendation | Business impact | Effort | ROI |
|---|----------------|-----------------|--------|-----|
| 4 | Add **knip** to architecture-gates (or weekly scheduled job) | Less dead code drag | S | **High** |
| 5 | Add **Dependabot** (npm + actions) | Security + dep freshness | S | **High** |
| 6 | Run **i18n parity** in `ci.yml` or promote `i18n-parity.test` visibility | Hebrew market quality | S | **High** |
| 7 | Document **required checks** list in `docs/devops/ci-cd.md` matching actual job names | Onboarding + protection setup | XS | **Medium** |
| 8 | Verify **Railway deploy mode** (git vs CLI) and whether `main` push deploys outside Actions | Release clarity | S | **High** |

### P2 — Speed and maintainability

| # | Recommendation | Effort | ROI |
|---|----------------|--------|-----|
| 9 | **Single CI platform** — generate GitLab from GitHub or vice versa, or delete inactive one | M | **High** long-term |
| 10 | Share **Vite build artifact** between CI test and Playwright jobs | M | **Medium** |
| 11 | Add **Playwright to `cursor/**` PR policy** (require PR to `main` for agents) | S | **Medium** |
| 12 | Scheduled **knip + depcruise** report artifact (non-blocking) | S | **Medium** |

### P3 — Mobile and production hardening

| # | Recommendation | Effort | ROI |
|---|----------------|--------|-----|
| 13 | Merge MR !20 **android:build** manual job + document secrets | M | **High** for Play store |
| 14 | Add **macOS job** for Capacitor archive smoke (manual/nightly only) | L | **Medium** |
| 15 | Post-deploy **health smoke** (`/api/health/ready`) against staging URL | M | **Medium** |
| 16 | Run **`validate:prod`** in deploy preflight when secrets present | S | **Medium** |

---

## Local pre-merge contract (authoritative when remote CI suspended)

From `MAINTENANCE_MODE.md` and `docs/devops/ci-cd.md`:

```bash
pnpm install --frozen-lockfile
npx tsc --noEmit
npx tsc --noEmit --project tsconfig.server-check.json
bash scripts/ci/contracts-gate.sh
pnpm migrate && pnpm test
pnpm test:integration:ops          # when touching ops/integration paths
pnpm architecture:gates            # optional full G1
pnpm test:playwright:ci            # when touching UI/realtime/PWA/Code Blue
```

---

## Quality gate maturity model

| Level | VetTrack today | Target |
|-------|----------------|--------|
| L1 Typecheck + unit tests | ✅ | Keep |
| L2 Architecture + contracts | ✅ GitHub / ⚠️ GitLab | Align GitLab |
| L3 E2E Playwright sharded | ✅ | Keep |
| L4 Branch protection + required checks | ❌ | **P0** |
| L5 SCA + knip + i18n in PR | Partial | **P1** |
| L6 Manual release gate before demo/ship | ✅ | Run before App Store |
| L7 Native build in CI | ❌ | **P3** |

---

## Next phase

**Phase 5 — Engineering Friction Analysis** → `ENGINEERING_FRICTION_REPORT.md` (onboarding, testing difficulty, bug-prone areas, cost estimates).
