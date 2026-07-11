# VetTrack repository scope & ship lane

> **Not frozen "maintenance" (reframed 2026-07-08).** This doc was titled "maintenance mode," but the repo is under an **active multi-phase program** (per-role UX · web management console · Command Center board — see [`docs/design/program-plan.md`](design/program-plan.md)). The doc's real purpose is narrower and still accurate: **what ships from THIS repo vs the sibling Expo/RN repo**, plus the native ship lane. Read it as scope-boundaries, not a freeze.

This repository is the **production monolith**: React web app, Express API, PostgreSQL, PWA/offline sync, and **Capacitor** native shell (iOS/Android). Active mobile strategy and Expo/RN work live elsewhere.

**Current native release:** 1.0.1 (Build 20) — App Store approved. See `ios/App/App.xcodeproj/project.pbxproj` and locales `whatsNew.*`.

## In scope (this repo)

- Web app (`src/`), API (`server/`), schema/migrations (`server/schema/`, `migrations/`)
- Capacitor native ship path — see [`docs/mobile/README.md`](mobile/README.md)
- PWA, offline Dexie sync, Code Blue / realtime frozen surfaces (`CLAUDE.md`)
- Railway deploy via GitHub Actions when `RAILWAY_USE_CLI_DEPLOY` is enabled

## Out of scope (other repo)

| Work | Where |
|------|--------|
| Expo / React Native app | [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop) |
| Horizon 1+ mobile implementation | literate-dollop agent runbook |

`@vettrack/contracts` is now authored **in this repo** at [`packages/contracts/`](../packages/contracts) — see [Contracts package](#contracts-package) below.

**Porting rule:** copy reference code from this repo into literate-dollop; do not delete production Capacitor paths here until Phase 6 kill-switch (future product decision).

**Product scope:** ER/patient, medication tasks, and formulary were removed June 2026 — [`docs/scope-change-2026.md`](scope-change-2026.md).

## Git remote

**`origin`** → `github.com/exposwifty31/vettrack` (canonical). Push PRs here only.

Clone and setup: [`docs/devops/github-setup.md`](devops/github-setup.md), [`docs/setup/environment.md`](setup/environment.md).

**Worktrees:**

| Path | Branch | Purpose |
|------|--------|---------|
| `/Users/dan/vettrack` | `main-sync` | Dev lane |
| `/Users/dan/vettrack-ship` | `main` | Ship lane (App Store releases) |

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
