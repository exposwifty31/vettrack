# VetTrack repository scope & ship lane

> **Not frozen "maintenance" (reframed 2026-07-08).** This doc was titled "maintenance mode," but the repo is under an **active multi-phase program** (per-role UX · web management console · Command Center board — see [`docs/design/program-plan.md`](design/program-plan.md)). The doc's real purpose is narrower and still accurate: **what ships from THIS repo vs the sibling Expo/RN repo**, plus the native ship lane. Read it as scope-boundaries, not a freeze.

This repository is the **production monolith**: React web app, Express API, PostgreSQL, PWA/offline sync, and **Capacitor** native shell (iOS/Android). Active mobile strategy and Expo/RN work live elsewhere.

**Current native release:** derive it, don't read it here — this line has been wrong before
(it said "1.0.1 (Build 20)" long after 1.2.0 shipped), and a number copied into prose always
drifts while a command does not:

```bash
node -p "require('./package.json').version"                             # marketing version of record
grep -m1 CURRENT_PROJECT_VERSION ios/App/App.xcodeproj/project.pbxproj  # build number
cat ios/.last-shipped-build                                             # last build uploaded to App Store Connect
```

Release notes live in `locales/*.json` under `whatsNew.*`. The full ship procedure is
[`RESUBMISSION_RUNBOOK.md`](../RESUBMISSION_RUNBOOK.md).

## In scope (this repo)

- Web app (`src/`), API (`server/`), schema/migrations (`server/schema/`, `migrations/`)
- Capacitor native ship path — see [`docs/mobile/README.md`](mobile/README.md)
- PWA, offline Dexie sync, Code Blue / realtime frozen surfaces (`CLAUDE.md`)
- Railway deploy via GitHub Actions when `RAILWAY_USE_CLI_DEPLOY` is enabled

## Out of scope (other repo)

| Work | Where |
|------|--------|
| Expo / React Native app | [`exposwifty31/VetTrack---RN-Migration-`](https://github.com/exposwifty31/VetTrack---RN-Migration-) |
| Horizon 1+ mobile implementation | `VetTrack---RN-Migration-` agent runbook |

`@vettrack/contracts` is now authored **in this repo** at [`packages/contracts/`](../packages/contracts) — see [Contracts package](#contracts-package) below.

**Porting rule:** copy reference code from this repo into `VetTrack---RN-Migration-`; do not delete production Capacitor paths here until Phase 6 kill-switch (future product decision).

**Product scope:** ER/patient, medication tasks, and formulary were removed June 2026 — [`docs/scope-change-2026.md`](scope-change-2026.md).

## Git remote

**`origin`** → `github.com/exposwifty31/vettrack` (canonical). Push PRs here only.

Clone and setup: [`docs/devops/github-setup.md`](devops/github-setup.md), [`docs/setup/environment.md`](setup/environment.md).

**Worktrees** (local, per-machine — a clone does not give you these):

| Path | Branch | Purpose | State |
|------|--------|---------|-------|
| `/Users/dan/vettrack` | `main` (plus feature branches) | Dev lane | The primary checkout |
| `/Users/dan/vettrack-ship` | `main` | Ship lane (App Store archives, clean tree only) | **Created on demand — often absent** |

Neither row is guaranteed on a given machine; run `git worktree list` to see the truth. The
ship lane in particular is created when needed and removed afterwards:

```bash
ls -d /Users/dan/vettrack-ship 2>/dev/null || \
  (cd /Users/dan/vettrack && git worktree add ../vettrack-ship main)
```

`scripts/archive-from-clean-tree.sh` blocks with that same command if the ship lane is
missing. There is **no `main-sync` branch** — this table named one for a while, and it
exists neither locally nor on `origin`.

## CI status

**GitHub Actions** is the active CI on `origin`. Workflow definitions: `.github/workflows/`.

Local verification remains the pre-merge contract:

```bash
pnpm install
bash scripts/ci/contracts-gate.sh
npx tsc --noEmit
npx tsc --noEmit --project tsconfig.server-check.json
pnpm test
```

See [`docs/devops/ci-cd.md`](devops/ci-cd.md).

## Contracts package

`@vettrack/contracts` lives **in this repo** as a local pnpm workspace package at [`packages/contracts/`](../packages/contracts), wired via a `workspace:*` dependency in root `package.json`. It was previously consumed from `exposwifty31/literate-dollop` via a `github:` path dependency; it was brought in-repo (2026-07-11) so the build no longer depends on an external private repo. The import specifier (`@vettrack/contracts`) is unchanged, so the emergency-surface parity contract is preserved.

```json
"@vettrack/contracts": "workspace:*"
```

After editing the contracts package, run `bash scripts/ci/contracts-gate.sh`.

## Related docs

- [`docs/scope-change-2026.md`](scope-change-2026.md) — product scope after migrations 142–143
- [`docs/governance/REPO_CLEANUP_MANIFEST.md`](governance/REPO_CLEANUP_MANIFEST.md) — repo hygiene inventory
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — tests, release flow, deployment variables
