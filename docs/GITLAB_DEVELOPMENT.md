# GitLab development (legacy / secondary remote)

> **Status (2026-06-20):** GitHub (`origin` → `github.com/exposwifty31/vettrack`) is the **canonical** remote. GitLab is a secondary mirror during migration. Use [`docs/devops/github-setup.md`](devops/github-setup.md) for primary workflow.

GitLab remote: `gitlab` → `https://gitlab.com/dboy31561/vettrack`

## Quick start

```bash
git clone git@gitlab.com:dboy31561/vettrack.git
cd vettrack
pnpm install
# minimal .env — see CLAUDE.md
pnpm dev
```

Use a [Personal Access Token](https://gitlab.com/-/user_settings/personal_access_tokens)
or SSH key for authentication. Do **not** embed tokens in the remote URL long term;
prefer `git credential` or SSH.

## Branch policy

**Never commit directly to `main`.** All work flows through merge requests.

| Branch | Purpose |
|--------|---------|
| `main` | Release line. Protected when CI is active. |
| `staging` | Integration branch when present; create from `main` if missing. |
| `feat/<topic>` | New features |
| `fix/<topic>` | Bug fixes |
| `chore/<topic>` | Tooling, CI, docs, deps |
| `docs/<topic>` | Documentation only |
| `refactor/<topic>` | Behaviour-preserving refactors |
| `test/<topic>` | Test-only changes |
| `cursor/<topic>` | Agent/automation branches (CI enabled on push when active) |

## Merge request workflow

1. Branch from `main` (or `staging` when that branch exists):
   ```bash
   git checkout main && git pull origin main
   git checkout -b feat/my-change
   ```
2. Commit with [conventional commits](https://www.conventionalcommits.org/):
   `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
3. Reference GitLab issues in the commit body: `Closes #123` or `Refs #123`.
4. Push and open an MR targeting **`main`** (or **`staging`** for integration work):
   ```bash
   git push -u origin feat/my-change
   glab mr create --target-branch main --fill   # optional: glab CLI
   ```
5. Wait for GitLab CI on the MR when pipelines are enabled (typecheck → build → test → integration → architecture).
6. **Squash-merge** when intermediate commits left CI red but the final MR head is green.
7. Delete the source branch after merge.

MR template: `.gitlab/merge_request_templates/Default.md`

## GitLab CI

Pipeline config: `.gitlab-ci.yml` was removed in favour of GitHub Actions (commit `f927e5b1`). GitLab pipelines may be stale until re-synced from GitHub.

| Trigger | Jobs |
|---------|------|
| MR → `main` or `staging` | typecheck, build, vitest, integration, architecture, playwright (sharded), merge gate |
| Push to `main` / `staging` | Same as above |
| Push to `feat/*`, `fix/*`, `chore/*`, … | Same (WIP branches without MR) |
| Push to `cursor/*` | Same |
| **Run pipeline** (web UI) | Release gate jobs (`release-gate:*`) |
| Schedule | flake-detection, workday-simulation, e2e-simulation |
| `RAILWAY_USE_CLI_DEPLOY=true` on `main` push | deploy preflight + Railway deploy (**leave disabled** unless explicitly approved) |

### Required CI/CD variables (GitLab → Settings → CI/CD → Variables)

Set at project level. Mask sensitive values.

| Variable | Required for | Notes |
|----------|----------------|-------|
| *(none)* | Default MR CI | Postgres service is defined in-job |
| `VITE_CLERK_PUBLISHABLE_KEY` | Optional | Defaults to dummy in CI |
| `RAILWAY_USE_CLI_DEPLOY` | Deploy jobs | Keep **`false`** or unset unless deploy approved |
| `RAILWAY_TOKEN`, `RAILWAY_SERVICE` | Deploy jobs | Only if deploy enabled |
| `DATABASE_URL`, `REDIS_URL`, … | Deploy preflight | Production secrets |
| `TEST_BASE_URL_STAGING`, `STAGING_E2E_PASSWORD_STAGING`, … | Staging E2E / workday simulation | Optional scheduled jobs |
| `SCHEDULED_JOB` | Pipeline schedules | `flake-detection`, `workday-simulation`, or `e2e-simulation` |

### Release gate (manual)

Before a pilot release, run **CI/CD → Pipelines → Run pipeline** on `main`.
Select variables if needed. This runs the seven `release-gate:*` jobs (formerly
GitHub Actions `release-gate.yml`).

## Git remotes

- **`origin`** → GitHub (`exposwifty31/vettrack`) — canonical
- **`gitlab`** → GitLab mirror — push here only when GitLab CI is explicitly needed

## Related docs

- [`docs/MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md) — what belongs in this repo vs literate-dollop
- `CONTRIBUTING.md` — release flow, tests, deployment variables
- `CLAUDE.md` — architecture invariants
- `.github/workflows/ci.yml` — active pipeline (GitHub)
- [`docs/devops/ci-cd.md`](devops/ci-cd.md) — workflow inventory + local parity commands
