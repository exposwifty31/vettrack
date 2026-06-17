# CI workflow troubleshooting

Valid workflow files live under `.github/workflows/*.yml` (GitHub) and `.gitlab-ci.yml` (GitLab). See [`docs/devops/ci-cd.md`](../../docs/devops/ci-cd.md).

Remote CI may be suspended — reproduce failures locally:

```bash
bash scripts/ci/contracts-gate.sh
npx tsc --noEmit
pnpm exec tsc --noEmit --project tsconfig.server-check.json
pnpm migrate && pnpm test
```

## Workflow name shows as file path, 0 jobs, instant failure

The runner failed to parse workflow YAML. Common causes:

1. **Mojibake in comments** — smart quotes or double-encoded UTF-8 (e.g. `â` instead of `-`). Use ASCII-only in workflow files.
2. **Invalid YAML syntax** — indentation, unquoted colons in strings.

Fix the file, push, and confirm the human-readable `name:` field appears in the CI UI when remotes are active.

## Stale workflow registration (`BuildFailed`)

A **stale workflow registration** may exist at path `BuildFailed` (not in git). It hooks `push` / `pull_request` and fails before the main CI workflow runs.

When GitHub Actions is active: open **Actions → All workflows**, find **BuildFailed** → disable workflow, then re-run or push a new commit.

## Required checks (when branch protection is enabled)

Typical required jobs:

- CI merge gate (tests + architecture gates)
- Playwright E2E (both shards)

Do **not** require nightly workflows (flake-detection, e2e-simulation, workday-simulation) or manual release-gate.

## Feature-branch CI

`ci.yml` runs on PR/push to `main`/`staging`, `push` to `cursor/**`, and `workflow_dispatch` when GitHub Actions is enabled.

## Contracts package

`architecture-gates` runs `scripts/ci/contracts-gate.sh` (`@vettrack/contracts` typecheck + emergency surface parity test). Run locally:

```bash
bash scripts/ci/contracts-gate.sh
```

After literate-dollop PR1, contracts are consumed from `exposwifty31/literate-dollop` — see [`docs/MAINTENANCE_MODE.md`](../../docs/MAINTENANCE_MODE.md).
