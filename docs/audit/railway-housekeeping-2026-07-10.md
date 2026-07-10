# Railway housekeeping report — 2026-07-10

Findings from the CI/Railway deploy review (PR #77). **Nothing here has been deleted or changed** — every item is confirm-before-act, for the project owner to decide.

## Confirm-before-delete candidates

| Item | Finding | Suggested action |
|------|---------|------------------|
| `Postgres-New` service (both envs) | Production `DATABASE_URL` resolves to `postgres.railway.internal` (the `Postgres` service). `Postgres-New` appears unreferenced. | Verify no variable in any service/env references `postgres-new.railway.internal`, check its connection metrics are flat, then delete via dashboard. |
| `NIXPACKS_NODE_VERSION` variable (VetTrack) | Dead since the builder is DOCKERFILE (`nixpacks.toml` was deleted in PR #77; `nixpacksProviders` is empty on deployments). | Remove the variable. |
| Old Railway dashboard tokens | The pre-2026-07-10 `RAILWAY_TOKEN` in GitHub secrets was **invalid** (first real use failed). It was replaced by the `ci-github-actions-deploy` production project token. | Revoke any stale/unused tokens on the project tokens page. |
| `dboy3156/VetTrack` GitHub repo | No Railway service deploys from it anymore (production Worker disconnected; Staging repointed to `exposwifty31/vettrack`). It had silently frozen Staging since May and the Worker since June 12. | Before archiving, verify no non-Railway consumers remain: GitHub Actions in other repos, webhooks, package consumers, documentation links, local deployment scripts. Record those checks, then archive. Also consider removing the stale `gitlab` remote from local clones. |
| `cursor/*` remote branches | 1 stale branch on origin (`git ls-remote --heads origin 'cursor/*'`). The `cursor/**` CI trigger was removed in PR #77. | Delete after confirming nothing references it. |

## Rename / config nits

| Item | Finding | Suggested action |
|------|---------|------------------|
| `Staging` environment name | The actual name has a **trailing space**. Any CLI `--environment` usage must quote the padded value exactly. | Rename to `staging` after confirming no token or script references the exact padded string. |
| Worker `NODE_ENV` | Unset in production Worker variables. Only effect in `notification.worker.ts` is verbose (non-production) logging. | Optionally set `NODE_ENV=production` for quieter logs; behavior is otherwise unaffected. |
| Duplicate S3-ish variable pairs (VetTrack) | Both `ACCESS_KEY_ID`/`S3_ACCESS_KEY_ID`, `ENDPOINT`/`S3_ENDPOINT`, `BUCKET`/`S3_BUCKET`, `SECRET_ACCESS_KEY`/`S3_SECRET_ACCESS_KEY`, `REGION`/`S3_REGION` exist. | Grep the server for which prefix is actually read, then drop the unused set. |

## Deploy pipeline — current state (post PR #77)

- **Canonical path:** CI `deploy` job on push/dispatch to `main` → `deploy.sh` → `railway up --ci` (VetTrack) → status poll to `SUCCESS` → `curl https://vettrack.uk/api/healthz` → `railway up --ci` (Worker) → status poll. Kill-switch: repo variable `RAILWAY_USE_CLI_DEPLOY`.
- **Auto-deploy:** disconnected for production VetTrack + Worker (no `source.repo` on either instance). Staging auto-deploys from `exposwifty31/vettrack@main` as a mirror.
- **Known API footgun:** Railway `serviceInstanceUpdate` **nulls `source` when omitted** from the input. Always re-include `source` (or expect disconnection) when updating instance config via GraphQL.
