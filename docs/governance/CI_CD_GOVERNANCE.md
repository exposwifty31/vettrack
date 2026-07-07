# VetTrack — CI/CD Governance Audit

**Phase:** 4 — CI/CD Governance Audit  
**Generated:** 2026-06-18 · **Updated:** 2026-07-07 (GitHub Actions only)  
**Governor:** Product Engineering Governor  
**Prerequisites:** [`ARCHITECTURE_MAP.md`](./ARCHITECTURE_MAP.md)  
**Canonical pipeline doc:** [`docs/devops/ci-cd.md`](../devops/ci-cd.md) · [`docs/devops/github-setup.md`](../devops/github-setup.md)  
**Active CI:** `.github/workflows/`

---

## Executive summary

VetTrack CI runs on **GitHub Actions** (`.github/workflows/`).

| Dimension | Grade | Headline |
|-----------|-------|----------|
| Build reliability | **B+** | Recent `main` green; failures cluster around native/auth TypeScript |
| Merge gate strength | **B** | Solid when enabled; verify branch protection lists **both** `ci.yml` merge gate and Playwright shards |
| Pipeline maintenance | **B** | Single GitHub Actions platform |
| Deploy safety | **B** | Railway gated off by default (`RAILWAY_USE_CLI_DEPLOY`); preflight script exists |
| Quality coverage gaps | **B-** | knip non-blocking in architecture gates; vitest excludes DB/live-server suites |
| Native/mobile CI | **D** | Manual `pnpm cap:build:native` only; no iOS/Android in merge path |

---

## Build system

### Stack

| Layer | Tooling | CI entry |
|-------|---------|----------|
| Package manager | pnpm 9.15.9, frozen lockfile | All jobs |
| Node | 22.x (`.nvmrc`) | `actions/setup-node` |
| Frontend build | Vite → `dist/public` | `pnpm build` |
| Server | `tsx` / `tsconfig.server-check.json` | Dual `tsc` |
| DB | Postgres 16 service container | `pnpm migrate` → `scripts/run-migrations.ts` |
| E2E | Playwright Chromium, 2 shards | `pnpm test:playwright:ci` |

### Parallelization (GitHub)

| Pattern | Status |
|---------|--------|
| `test` ∥ `integration-ops` ∥ `architecture-gates` | **Good** |
| Playwright 2 shards, `fail-fast: false` | **Good** |
| `concurrency: cancel-in-progress` per ref | **Good** |
| Duplicate `pnpm install` + dual `tsc` in `test` and `architecture-gates` | **Medium waste** — acceptable for isolation |

### Cache

| Mechanism | Assessment |
|-----------|------------|
| `actions/setup-node` `cache: pnpm` keyed on lockfile | **Good** |
| Playwright browsers re-installed each run | **Acceptable** (~30–60s) |
| Vite build not shared between CI test and Playwright jobs | **Opportunity** — artifact reuse |

---

## Workflows inventory (GitHub Actions)

| Workflow | Trigger | Blocking? | Purpose |
|----------|---------|-----------|---------|
| `ci.yml` | PR/push `main`, `staging`; push `cursor/**`; manual | **Yes** (merge gate job) | tsc, build, migrate, vitest, integration-ops, architecture, optional Railway deploy |
| `playwright.yml` | PR/push `main`, `master`, `staging` | **De facto** (separate workflow) | 2-shard E2E against local API |
| `release-gate.yml` | Manual only | No | Pilot readiness: i18n parity, PWA, offline, a11y, extended tests |
| `flake-detection.yml` | Nightly 03:00 UTC; manual | No | Repeat vitest 2–5× |
| `workday-simulation-nightly.yml` | Nightly 04:00 UTC; manual | No | Staging URL workday suite |
| `e2e-simulation-nightly.yml` | Nightly 05:00 UTC; manual | No | Local simulation |
| `staging-e2e-manual.yml` | Manual on `staging` | No | Staging auth/Code Blue smoke |

### Known gaps

| Issue | Severity | Detail |
|-------|----------|--------|
| Playwright not inside `ci.yml` merge gate | **High** | Branch protection must require **both** workflows |
| `ci.yml` on `cursor/**` without Playwright | **Medium** | Agent pushes get unit CI but not E2E until PR to `main` |
| Stale `BuildFailed` workflow | **Medium** | Disable in GitHub UI if present — see `TROUBLESHOOTING.md` |
| Native Capacitor build absent from CI | **High** (mobile ship) | Manual `pnpm cap:build:native` per `CLAUDE.md` |

---

## Deployment

### Production path

```text
push main
  → (if vars.RAILWAY_USE_CLI_DEPLOY == 'true' AND secrets set)
      deploy.sh --check
      deploy.sh → railway cli up --service $RAILWAY_SERVICE --detach
  → else: skip (current default)
```

**Observed:** Deploy jobs often **skipped** when `RAILWAY_USE_CLI_DEPLOY` is not enabled. Verify whether Railway Git integration deploys independently of Actions.

### Rollback capability

| Mechanism | Available? | Notes |
|-----------|------------|-------|
| Railway deployment history rollback | **Yes** (platform) | Not automated in repo |
| DB migration rollback | **Manual** | Forward-only SQL migrations |
| PWA `__VT_BUILD_TAG__` | **Yes** | Client cache bust on new build |
| Authority evaluators `shadow` mode | **Yes** | Per-clinic degrade paths |

---

## Quality gates

### Merge-blocking (when CI active + branch protection configured)

| Gate | `ci.yml` | `playwright.yml` | Local contract |
|------|----------|------------------|----------------|
| Frontend `tsc` | ✅ | — (build only) | `npx tsc --noEmit` |
| Server `tsc` | ✅ | — | `tsconfig.server-check.json` |
| `pnpm build` | ✅ | ✅ | `pnpm build` |
| `pnpm migrate` + vitest | ✅ | ✅ (E2E path) | `pnpm test` |
| `test:integration:ops` | ✅ | — | `pnpm test:integration:ops` |
| `@vettrack/contracts` + emergency parity | ✅ | — | `scripts/ci/contracts-gate.sh` |
| dependency-cruiser + cycle baseline | ✅ | — | `pnpm architecture:gates` |
| tenant / query-key / route lint | Warn-only | — | `pnpm tenant:lint:touched` |
| Playwright CI suite (2 shards) | Separate workflow | ✅ | `pnpm test:playwright:ci` |
| i18n parity | ✅ in vitest (`i18n-parity.test`) | — | `pnpm i18n:check` |

### Not in PR lane (gaps)

| Check | Where it runs | Severity |
|-------|---------------|----------|
| **knip** (dead exports) | Non-blocking in architecture gates | **Medium** — monitor growth |
| **Dependabot / SCA** | Not configured | **High** |
| **DB integration tests** | Excluded from default vitest | **Medium** |
| **Live-server tests** | Excluded | **Medium** |
| **Native Capacitor build** | Manual scripts | **High** for store ship |
| **`validate:prod`** | Manual | **Medium** |

### Release gate (manual — `release-gate.yml`)

Richer than PR CI: extended vitest groups, PWA/offline drills, accessibility structure. **Non-blocking** for daily merges; run before pilot/demo/App Store submission.

---

## Recommendations ranked by ROI

### P0 — Restore trust in the delivery pipeline

| # | Recommendation | Effort | ROI |
|---|----------------|--------|-----|
| 1 | **Enable branch protection** requiring `CI — VetTrack` merge gate + both Playwright shards | S | **Very high** |
| 2 | Document **required checks** list in `docs/devops/ci-cd.md` matching actual GitHub job names | XS | **High** |
| 3 | Verify **Railway deploy mode** (git vs CLI) vs Actions skip behavior | S | **High** |

### P1 — Close quality gaps without slowing every PR

| # | Recommendation | Effort | ROI |
|---|----------------|--------|-----|
| 4 | Add **Dependabot** (npm + actions) | S | **High** |
| 5 | Scheduled **knip report** artifact (non-blocking) | S | **Medium** |
| 6 | Share **Vite build artifact** between CI test and Playwright jobs | M | **Medium** |

### P2 — Mobile and production hardening

| # | Recommendation | Effort | ROI |
|---|----------------|--------|-----|
| 7 | Nightly or manual **macOS Capacitor archive smoke** | L | **Medium** |
| 8 | Post-deploy **health smoke** (`/api/health/ready`) against staging URL | M | **Medium** |
| 9 | Run **`validate:prod`** in deploy preflight when secrets present | S | **Medium** |

---

## Local pre-merge contract (authoritative when remote CI suspended)

From `MAINTENANCE_MODE.md` and `docs/devops/ci-cd.md`:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
bash scripts/ci/contracts-gate.sh
pnpm migrate && pnpm test
pnpm test:integration:ops          # when touching ops/integration paths
pnpm architecture:gates            # when touching server/module boundaries
pnpm i18n:check                    # when touching locales
pnpm test:playwright:ci            # when touching UI/realtime/PWA/Code Blue
```

---

## Quality gate maturity model

| Level | VetTrack today | Target |
|-------|----------------|--------|
| L1 Typecheck + unit tests | ✅ | Keep |
| L2 Architecture + contracts | ✅ GitHub | Keep |
| L3 E2E Playwright sharded | ✅ | Keep |
| L4 Branch protection + required checks | ⚠️ verify | **P0** |
| L5 SCA + knip visibility in PR | Partial | **P1** |
| L6 Manual release gate before demo/ship | ✅ | Run before App Store |
| L7 Native build in CI | ❌ | **P2** |

---

## Next phase

**Phase 5 — Engineering Friction Analysis** → [`ENGINEERING_FRICTION_REPORT.md`](./ENGINEERING_FRICTION_REPORT.md)
