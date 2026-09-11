# Railway API gotchas

Facts verified while cleaning up the production project on 2026-09-10/11. Every line
here cost real time; none of it is in Railway's docs in this form.

Project `VetTrack` (`adf88531-…`), environment `production` (`63549599-…`) — the **only**
environment. Services: `VetTrack`, `Worker`, `Redis`, `Postgres`. Deploys are CI-driven
via `deploy.sh`; neither app service has a GitHub source.

## Staged changes

- The Railway MCP `get-staged-changes` renders an **empty** patch as "every variable
  removed" — it diffs an empty patch object against the live config. Verify patch content
  with GraphQL `environmentStagedChanges(environmentId) { patch }`; a real patch lists only
  the changed keys.
- There is **no "discard patch" mutation**. `environmentStageChanges(environmentId,
  input: {}, merge: false)` sets the patch to `{}` (harmless), but the STAGED record persists
  until something is committed. Committing any patch with
  `environmentPatchCommitStaged(environmentId, skipDeploys: true)` clears it.
- `variableDelete` has **no `skipDeploys`**. To delete without deploying:
  `environmentStageChanges(input: { services: { <serviceId>: { variables: { KEY: null } } } },
  merge: true)` → confirm in the dashboard ("Apply N changes") →
  `environmentPatchCommitStaged(skipDeploys: true)`.
- `variableUpsert` / `variableCollectionUpsert` accept `skipDeploys: true` and
  `replace: false`.

## Service config and images

- `serviceInstanceUpdate` applies **immediately** — it is not staged. `buildCommand: null`
  is a no-op (GraphQL null = omitted); pass `""` to clear a value. It also nulls `source`
  when `source` is omitted from the input.
- `serviceInstanceVulnRemediationPatchNow(environmentId, serviceId)` is the right way to
  apply a pending image remediation (Railway takes a backup, then redeploys on the armed
  image). The MCP `redeploy` reuses the **existing** image — it does not pull the new one —
  and on Dockerfile services it also rebuilds (~3 min); it is not the
  `usePreviousImageTag` path.
- `railway.json` `"builder": "DOCKERFILE"` overrides whatever builder the dashboard shows;
  the dashboard `buildCommand` is ignored for Dockerfile builds (build logs say
  `load build definition from Dockerfile`).

## Variables

- `railway variables --json` returns **rendered** values — it cannot distinguish a
  `${{Service.VAR}}` reference from a literal. Use GraphQL
  `variables(projectId, environmentId, serviceId, unrendered: true)`.
- Never print variable values. Pipe `--json` into `jq` expressions that return
  `true` / `false` / `length`, or into a consumer — not into a terminal.

## CLI, SSH, tokens

- `~/.railway/config.json` holds `user.accessToken` (it expires; `railway whoami`
  refreshes it) — not `user.token`. Use `npx @railway/cli@5.26.0`; the brew `railway`
  is stale.
- `railway run` injects the **internal** `DATABASE_URL` (`*.railway.internal`); from a
  laptop use `DATABASE_PUBLIC_URL`, which needs a TCP proxy on the service.
- `railway ssh` needs a registered SSH key (`railway ssh keys add --key <pub> --name
  <label>`) and a **running** deployment. In a non-TTY shell add the host key first:
  `ssh-keyscan ssh.railway.com >> ~/.ssh/known_hosts`.
- Project deletion is a **48 h soft-delete** (`project.deletedAt` is set);
  `list-projects` keeps showing the project until the purge.
- After a GitHub account tied to a Railway login is deleted, "Login with GitHub" from a
  different GitHub account creates a **new, empty** Railway account. Keep an email or
  second-provider login on the Railway account before touching GitHub.

## Clerk webhooks (adjacent, same cleanup)

- Clerk's webhook UI is an embedded Svix App Portal (cross-origin iframe). A standalone
  portal URL comes from `POST https://api.clerk.com/v1/webhooks/svix_url` with the Clerk
  secret key.
- Svix auto-**disables** an endpoint after sustained signature failures and the Clerk UI
  does not shout about it. Re-enable via Actions → Enable Endpoint after fixing the
  secret, then send a test event and confirm `2xx`.
