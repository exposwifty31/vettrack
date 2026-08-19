# Staging Clerk E2E runbook

Staging-only infrastructure for temporary Clerk test users, `vt_users` mapping, Playwright auth smoke, and cleanup. **Never run against production Clerk or production DB.**

## Prerequisites

- Staging deploy healthy (`https://vettrack-staging.up.railway.app`)
- `sk_test_*` / `pk_test_*` Clerk keys (staging Clerk application)
- Staging `DATABASE_URL` (internal or approved staging host)
- `CLERK_WEBHOOK_SECRET` configured on staging (webhook validation passed)

## GitHub Actions (manual)

Workflow: **Staging E2E (manual)** (`.github/workflows/staging-e2e-manual.yml`)

- **Trigger:** `workflow_dispatch` only (not on push/PR).
- **Branch:** must select branch **`staging`** in the Actions UI; other refs fail the branch guard job.
- **Secrets:** suffixed `_STAGING` only (never production `DATABASE_URL` / `CLERK_SECRET_KEY`):

| GitHub secret | Maps to runtime env |
|---------------|---------------------|
| `DATABASE_URL_STAGING` | `DATABASE_URL` |
| `CLERK_SECRET_KEY_STAGING` | `CLERK_SECRET_KEY` |
| `VITE_CLERK_PUBLISHABLE_KEY_STAGING` | `VITE_CLERK_PUBLISHABLE_KEY` |
| `STAGING_E2E_PASSWORD_STAGING` | `STAGING_E2E_PASSWORD` |
| `TEST_BASE_URL_STAGING` | `TEST_BASE_URL` |

### Where these secrets must live — owner action, not yet done

Both staging workflows now declare an `environment:`, but **an environment with no protection
rules is not a gate.** Until the two below are configured in *Settings → Environments*, the
`if:` branch guards are the only thing standing between a dispatch and the staging database.

| Environment | Used by | Deployment branch policy | Why that ref |
|---|---|---|---|
| `staging-e2e` | `staging-e2e-manual.yml` | selected branches → `staging` | dispatch-only; the workflow refuses any other ref |
| `staging-simulation` | `workday-simulation-nightly.yml` | selected branches → `main` | a `schedule:` trigger always fires on the default branch |

Hold the `_STAGING` secrets **on those environments, not on the repository.** A repository
secret is readable by every workflow in the repo — including one added by a future PR — so
repo-scoping these is the finding, and moving them is the fix. Two environments rather than
one shared `staging`, because a single environment would have to trust both `staging` and
`main`, which is the weaker rule.

The two workflows need **different** secret sets, so each environment holds only what its
own job reads — an environment carrying the other's secrets re-opens the finding at a
smaller scale:

| Secret | `staging-e2e` | `staging-simulation` |
|---|:--:|:--:|
| `DATABASE_URL_STAGING` | ✅ (seed/cleanup write to it) | — |
| `CLERK_SECRET_KEY_STAGING` | ✅ | ✅ |
| `VITE_CLERK_PUBLISHABLE_KEY_STAGING` | ✅ | ✅ |
| `STAGING_E2E_PASSWORD_STAGING` | ✅ | ✅ |
| `TEST_BASE_URL_STAGING` | ✅ | ✅ |

Reviewer's aid, since "did anyone actually do it" is the part that rots. All four checks
must pass, not just the first:

```bash
R=exposwifty31/vettrack
gh api repos/$R/environments -q '.environments[].name'            # both must be listed
for e in staging-e2e staging-simulation; do
  echo "== $e =="
  gh api repos/$R/environments/$e/deployment-branch-policies -q '.branch_policies[].name'
  gh api repos/$R/environments/$e/secrets -q '.secrets[].name'
done
gh api repos/$R/actions/secrets -q '.secrets[].name' | grep '_STAGING$'   # must print NOTHING
```

Expected: `staging-e2e` → branch policy `staging`; `staging-simulation` → branch policy
`main`; each environment listing exactly its column above; and the last command silent. A
repository-scoped `_STAGING` secret surviving the migration means every workflow in the repo
can still read it, which is the finding restated rather than fixed.

Steps (in order): `pnpm staging:seed` → `pnpm test:staging:e2e` → `pnpm test:staging:walkthrough` → `pnpm staging:cleanup` (cleanup runs with `if: always()`).

### Run manually

1. Open **Actions** → **Staging E2E (manual)**.
2. Click **Run workflow**.
3. Set **Use workflow from** to branch **`staging`**.
4. Run workflow.

Concurrency: one run per ref (`staging-e2e-manual-refs/heads/staging`); a new run cancels an in-progress one.

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

`PW_SUITE=ci` includes exactly `pwa.spec.ts` and `phase-9-drills.spec.ts`.

`signup-flow.spec.ts` is a **separate** suite (`pnpm test:playwright:signup`), as are
`ui-smoke.spec.ts` (`test:playwright:ui-smoke`) and `e2e/simulation/workday.spec.ts`
(`PW_SUITE=workday`). `staging-*.spec.ts` runs under `playwright.staging.config.ts` via
`pnpm test:staging:e2e` / `test:staging:walkthrough` — never under `ci`.

## Clerk dashboard test delivery

After seed, you can send a Clerk **test webhook** from the staging dashboard; the handler should return **200** for valid signatures (already validated separately).
