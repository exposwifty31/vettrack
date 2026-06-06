# GitLab development (temporary primary remote)

GitHub is temporarily unavailable. **GitLab is the active development remote**
until GitHub access is restored. Production deployment via Railway is unchanged
and out of scope for this workflow.

**Canonical remote:** `https://gitlab.com/dboy3156/vettrack`

## Quick start

```bash
git clone https://gitlab.com/dboy3156/vettrack.git
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
| `main` | Release line (46 commits ahead of production commit `8b174eb0`). Protected. |
| `staging` | Integration branch when present; create from `main` if missing. |
| `feat/<topic>` | New features |
| `fix/<topic>` | Bug fixes |
| `chore/<topic>` | Tooling, CI, docs, deps |
| `docs/<topic>` | Documentation only |
| `refactor/<topic>` | Behaviour-preserving refactors |
| `test/<topic>` | Test-only changes |
| `cursor/<topic>` | Agent/automation branches (CI enabled on push) |

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
5. Wait for GitLab CI on the MR (typecheck → build → test → integration → architecture).
6. **Squash-merge** when intermediate commits left CI red but the final MR head is green.
7. Delete the source branch after merge.

MR template: `.gitlab/merge_request_templates/Default.md`

## GitLab CI

Pipeline config: `.gitlab-ci.yml` (migrated from `.github/workflows/`).

| Trigger | Jobs |
|---------|------|
| MR → `main` or `staging` | typecheck, build, vitest, integration, architecture, playwright (sharded), merge gate |
| Push to `main` / `staging` | Same as above |
| Push to `feat/*`, `fix/*`, `chore/*`, … | Same (WIP branches without MR) |
| Push to `cursor/*` | Same |
| **Run pipeline** (web UI) | Release gate jobs (`release-gate:*`) |
| Schedule | flake-detection, workday-simulation, e2e-simulation |
| `RAILWAY_USE_CLI_DEPLOY=true` on `main` push | deploy preflight + Railway deploy (**leave disabled** during GitHub outage unless explicitly approved) |

### Required CI/CD variables (GitLab → Settings → CI/CD → Variables)

Set at project level. Mask sensitive values.

| Variable | Required for | Notes |
|----------|----------------|-------|
| *(none)* | Default MR CI | Postgres service is defined in-job |
| `VITE_CLERK_PUBLISHABLE_KEY` | Optional | Defaults to dummy in CI |
| `RAILWAY_USE_CLI_DEPLOY` | Deploy jobs | Keep **`false`** or unset — Railway is frozen |
| `RAILWAY_TOKEN`, `RAILWAY_SERVICE` | Deploy jobs | Only if deploy enabled |
| `DATABASE_URL`, `REDIS_URL`, … | Deploy preflight | Production secrets — do not change during outage |
| `TEST_BASE_URL_STAGING`, `STAGING_E2E_PASSWORD_STAGING`, … | Staging E2E / workday simulation | Optional scheduled jobs |
| `SCHEDULED_JOB` | Pipeline schedules | `flake-detection`, `workday-simulation`, or `e2e-simulation` |

### Release gate (manual)

Before a pilot release, run **CI/CD → Pipelines → Run pipeline** on `main`.
Select variables if needed. This runs the seven `release-gate:*` jobs (formerly
GitHub Actions `release-gate.yml`).

## GitLab MCP (Cursor)

1. Install the **GitLab** plugin from Cursor Marketplace.
2. Merge into `.cursor/mcp.json`:
   ```json
   {
     "mcpServers": {
       "GitLab": {
         "type": "http",
         "url": "https://gitlab.com/api/v4/mcp"
       }
     }
   }
   ```
3. **Settings → Cursor Settings → Tools & MCP** — authorize via OAuth (`mcp_auth` in chat if browser does not open).
4. Requires GitLab account with **GitLab Duo** and beta features (see plugin README).

Fine-grained PATs used for `git push` may lack MCP/pipeline scopes; OAuth is separate.

## GitHub recovery (planning only)

See **GitHub Recovery Plan** in the recovery report (`docs/GITLAB_DEVELOPMENT.md` is the operational guide; full sync plan is maintained in agent deliverables / issue tracker).

Summary:

- GitLab `main` remains the integration source during the outage.
- On GitHub restore: add GitHub as a second remote, mirror branches, open PRs for delta review.
- Do **not** force-push GitHub `main` from GitLab without reviewing the 46-commit delta vs production.
- Preserve conventional commits and MR squash history for clean cherry-pick/replay.

## Related docs

- `CONTRIBUTING.md` — release flow, tests, deployment variables
- `CLAUDE.md` — architecture invariants
- `.gitlab-ci.yml` — pipeline source of truth
