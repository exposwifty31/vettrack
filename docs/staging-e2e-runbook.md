# Staging Clerk E2E runbook

Staging-only infrastructure for temporary Clerk test users, `vt_users` mapping, Playwright auth smoke, and cleanup. **Never run against production Clerk or production DB.**

## Prerequisites

- Staging deploy healthy (`https://vettrack-staging.up.railway.app`)
- `sk_test_*` / `pk_test_*` Clerk keys (staging Clerk application)
- Staging `DATABASE_URL` (internal or approved staging host)
- `CLERK_WEBHOOK_SECRET` configured on staging (webhook validation passed)

## GitHub Actions — removed 2026-08-19, and why

**There is no CI automation for staging any more.** Two workflows used to exist —
`staging-e2e-manual.yml` and `workday-simulation-nightly.yml` — and both were deleted.
Everything they did is available locally, from this runbook, against the same real staging
deployment. Nothing was lost; a false coverage signal was.

**What went wrong, recorded so it is not rebuilt the same way.** Both workflows hard-depended
on a `staging` **git branch** that has never existed on origin
(`git ls-remote --heads origin staging` prints nothing; it exits 0 whether or not the ref
exists, so the evidence is the empty output, never the status), plus `*_STAGING` repository
secrets that were never set.

- The nightly ran **every night and reported success while executing nothing**. Its preflight
  "skip" step ran `exit 0`, which succeeds a *step* but does not skip a *job*, so the run fell
  through to `actions/checkout` with `ref: staging`, failed there, and `continue-on-error: true`
  painted the whole run green. Run `32100016045` (2026-08-18): run conclusion *success*, job
  conclusion *failure*, 40 seconds, zero simulation. A gate that silently no-ops is worse than
  no gate, because it gets counted as coverage.
- The manual workflow had **zero runs ever**. `workflow_dispatch` makes you choose a ref, and
  its guard accepted only `refs/heads/staging`, so no dispatch could reach the job.

**If staging CI is rebuilt, three constraints carry over.**

1. **Do not key it on a git branch.** The Playwright suites reach staging through
   `TEST_BASE_URL`, not through a checkout, so branch state was never load-bearing — it was
   the accidental precondition that made both workflows unrunnable.
2. **Keep an environment guard of some kind.** The old branch guard was crude but it existed
   for a real reason: these jobs run `pnpm staging:seed` and `pnpm staging:cleanup` against a
   live database. Dispatching from `main` would have pointed seed and cleanup at the wrong
   environment. Weakening that guard to make a workflow "runnable" is the dangerous fix.
3. **Never pair a soft-fail preflight with `continue-on-error`.** That combination is exactly
   what produced a year of green nights over a job that never ran.

**Secrets a rebuild would need** (`*_STAGING` only — never production `DATABASE_URL` /
`CLERK_SECRET_KEY`):

| GitHub secret | Maps to runtime env |
|---------------|---------------------|
| `DATABASE_URL_STAGING` | `DATABASE_URL` |
| `CLERK_SECRET_KEY_STAGING` | `CLERK_SECRET_KEY` |
| `VITE_CLERK_PUBLISHABLE_KEY_STAGING` | `VITE_CLERK_PUBLISHABLE_KEY` |
| `STAGING_E2E_PASSWORD_STAGING` | `STAGING_E2E_PASSWORD` |
| `TEST_BASE_URL_STAGING` | `TEST_BASE_URL` |

Order, if rebuilt: `pnpm staging:seed` → `pnpm test:staging:e2e` → `pnpm test:staging:walkthrough`
→ `pnpm staging:cleanup` (cleanup with `if: always()`).

**Until then, run it locally** — the sections below are the supported path and are what the
workflows wrapped.

## Environment (local shell — do not commit)

```bash
export STAGING_E2E_CONFIRM=yes
export STAGING_E2E_PASSWORD='<strong-password-min-12-chars>'
export DATABASE_URL='postgresql://...'   # staging only
export CLERK_SECRET_KEY='sk_test_...'
export VITE_CLERK_PUBLISHABLE_KEY='pk_test_...'
export TEST_BASE_URL='https://vettrack-staging.up.railway.app'
```

Optional:

- `STAGING_E2E_CLINIC_ID` (default `dev-clinic-default`)
- `STAGING_E2E_AUTO_CLEANUP=yes` — run `pnpm staging:cleanup` after Playwright
- `STAGING_E2E_FORCE=yes` — only if DB host guard needs override (avoid unless certain)

## 1. Seed staging personas

Creates six Clerk users (`staging-e2e-*@vettrack-e2e.example.com`) and matching `vt_users` rows:

| Persona | Role | Status | Notes |
|---------|------|--------|-------|
| admin | admin | active | Code Blue manager |
| vet | vet | active | Open clinical check-in |
| technician | technician | active | Open clinical check-in |
| student | student | active | Non-clinical |
| pending | technician | pending | Approval gate |
| blocked | technician | blocked | Block gate |

```bash
pnpm staging:seed
```

Writes `.staging-e2e-manifest.json` (gitignored) for tests and cleanup.

## 2. Run Playwright staging E2E

```bash
pnpm test:staging:e2e
```

Specs:

- `tests/staging-auth-smoke.spec.ts` — health, `/api/users/me` role/status matrix
- `tests/staging-code-blue-gating.spec.ts` — Code Blue API auth gates on staging
- `tests/staging-walkthrough.spec.ts` — full UI walkthrough (routes, permissions, screenshots, matrix)

Full UI walkthrough only:

```bash
pnpm test:staging:walkthrough
```

Artifacts: `artifacts/staging-walkthrough/` (screenshots per persona/route, `matrix.json`).

## 3. Cleanup

```bash
pnpm staging:cleanup
```

Deletes manifest Clerk users, `vt_users` rows, clinical check-ins, and clears the manifest.

## Safety gates

`scripts/staging/guard.ts` refuses:

- `sk_live_*` / `pk_live_*`
- Known production DB host patterns
- Runs without `STAGING_E2E_CONFIRM=yes`

Playwright refuses non-staging `TEST_BASE_URL` and non-test Clerk keys.

## Playwright sign-in helper

`tests/staging/helpers.ts` uses `@clerk/testing` ticket sign-in for seeded users, dismisses optional Clerk org/onboarding overlays when the UI fallback runs, and signs out via `clerk.signOut` between serial persona tests.

## Playwright matrix (suite separation)

| Spec / command | Config | Safe target | Category |
|----------------|--------|-------------|----------|
| `pnpm test:staging:e2e` | `playwright.staging.config.ts` | `https://vettrack-staging.up.railway.app` after `staging:seed` | **Staging-safe** |
| `pnpm staging:seed` / `staging:cleanup` | (scripts) | Staging DB + `sk_test_*` Clerk only | **Staging-safe** |
| `pnpm test:playwright:ci` | `playwright.config.ts` (`PW_SUITE=ci`) | `http://127.0.0.1:3001` + `PLAYWRIGHT_E2E=true` (CI) | **Local/CI only** — default allowlist |
| `pnpm test:playwright:signup` / `test:signup` | `PW_SUITE=signup` | Local/CI with `DATABASE_URL` + optional `sk_test_*` | **Local/CI** (destructive: creates users) |
| `tests/pwa.spec.ts` | default config | Local/CI API | **Local/CI only** |
| `tests/phase-9-drills.spec.ts` | default config | Local/CI API (`/api/metrics` needs dev bypass) | **Local/CI only** |
| `tests/ui-smoke.spec.ts` | `playwright.ui.config.ts` | Documented for prod URL; needs real session | **Needs mocks** / prod-oriented |
| `tests/example.spec.ts` | (excluded) | N/A — not VetTrack | **Excluded** |

### Warnings

- **Default Playwright** (`playwright.config.ts`) **must not** use `TEST_BASE_URL` pointing at **production** (`vettrack.uk`) or **staging** (`vettrack-staging.up.railway.app`). The config logs a warning if those hosts are detected.
- **Staging specs** (`staging-*.spec.ts`) are **ignored** by the default config. They run **only** via `pnpm test:staging:e2e`.
- **Never run on production:** `staging:seed`, `staging:cleanup`, `test:staging:e2e`, `signup-flow` DB/Clerk mutations, `phase-9-drills` drill 4 (SSE storm load).

### Local/CI Playwright (default config)

```bash
# Typical CI / local API E2E (see .github/workflows/playwright.yml)
export TEST_BASE_URL=http://127.0.0.1:3001
export PLAYWRIGHT_E2E=true
pnpm test:playwright:ci
```

Includes: `pwa.spec.ts`, `phase-9-drills.spec.ts`, `signup-flow.spec.ts` (not `staging-*.spec.ts` or `example.spec.ts`).

## Clerk dashboard test delivery

After seed, you can send a Clerk **test webhook** from the staging dashboard; the handler should return **200** for valid signatures (already validated separately).
