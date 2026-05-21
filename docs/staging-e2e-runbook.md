# Staging E2E — release gate checklist

Short checklist for the **staging → production** gate. Full promotion flow, rollbacks, and forbidden actions: **[release-runbook.md](release-runbook.md)**.

**Staging URL:** `https://vettrack-staging.up.railway.app`

---

## Before you run E2E

- [ ] Feature work is merged into branch **`staging`** (not only a feature branch).
- [ ] **Railway** staging deployment is **SUCCESS**.
- [ ] Staging liveness:

```bash
curl -sfS https://vettrack-staging.up.railway.app/api/healthz
# expect: ok
```

---

## Run Staging E2E (manual)

| # | Check |
|---|--------|
| 1 | GitHub → **Actions** → **Staging E2E (manual)** |
| 2 | **Run workflow** → **Use workflow from:** **`staging`** (required) |
| 3 | Workflow finishes **success** (seed → Playwright → cleanup) |

Workflow file: `.github/workflows/staging-e2e-manual.yml` (registered from `main`; execution **must** use branch `staging`).

**Repository secrets (staging only):** `DATABASE_URL_STAGING`, `CLERK_SECRET_KEY_STAGING`, `VITE_CLERK_PUBLISHABLE_KEY_STAGING`, `STAGING_E2E_PASSWORD_STAGING`, `TEST_BASE_URL_STAGING`.

---

## After E2E passes

- [ ] Do **not** merge to `main` if E2E failed — see [Rollback: staging E2E failed](release-runbook.md#rollback-staging-e2e-failed).
- [ ] Open **PR: `staging` → `main`** only when E2E is green and staging healthz is OK.
- [ ] After production merge: verify `https://vettrack.uk/api/healthz`, `/api/version`, `/api/health/startup` — [Phase 3](release-runbook.md#phase-3--promote-staging--production).

---

## Never (summary)

- No `staging:seed` / `staging:cleanup` / `test:staging:e2e` on **production**
- No `sk_test_*` on **production** Railway
- No production Clerk users in tests
- No default Playwright (`playwright.config.ts`) with `TEST_BASE_URL` = production or staging

Details: [Forbidden actions](release-runbook.md#forbidden-actions-never-do-these).

---

## E2E implementation reference

Seed personas, local env vars, spec list, and Playwright matrix live on the **`staging`** branch in this file’s expanded form. On `main`, see `origin/staging:docs/staging-e2e-runbook.md` or merge `staging` for the full staging-only runbook body.
