# Staging Clerk E2E runbook

## GitHub Actions registration (default branch)

The workflow file `.github/workflows/staging-e2e-manual.yml` is present on **`main`** only so GitHub registers **Staging E2E (manual)** for `workflow_dispatch`.

When you run it from the Actions UI or CLI, always select branch **`staging`** (the job refuses other refs). Full runbook steps, secrets, and specs live on the **`staging`** branch copy of this file.
