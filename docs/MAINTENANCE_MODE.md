# VetTrack maintenance mode

This repository is the **production monolith**: React web app, Express API, PostgreSQL, PWA/offline sync, and **Capacitor** native shell (iOS/Android). Active mobile strategy and Expo/RN work live elsewhere.

## In scope (this repo)

- Web app (`src/`), API (`server/`), schema/migrations (`server/schema/`, `migrations/`)
- Capacitor Build 15 ship path — see [`docs/mobile/README.md`](mobile/README.md)
- PWA, offline Dexie sync, Code Blue / realtime frozen surfaces (`CLAUDE.md`)
- Railway deploy when CI remotes resume

## Out of scope (other repo)

| Work | Where |
|------|--------|
| Expo / React Native app | [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop) |
| `@vettrack/contracts` authoring | [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop) `packages/contracts` |
| Horizon 1+ mobile implementation | literate-dollop agent runbook |

**Porting rule:** copy reference code from this repo into literate-dollop; do not delete production Capacitor paths here until Phase 6 kill-switch (future product decision).

## Git remotes

- **`origin`** — GitLab (`gitlab.com/dboy31561/vettrack`) when pushing is active
- **No** `github.com/exposwifty31/vettrack` — that remote must not be added

```bash
git remote -v   # expect origin only (or GitLab + other approved remotes)
```

Remove a stale GitHub remote if present:

```bash
git remote remove github
```

## CI status

Remote merge gates (GitLab / GitHub Actions) may be **suspended**. Treat **local verification** as the contract before merge:

```bash
pnpm install
bash scripts/ci/contracts-gate.sh
npx tsc --noEmit
npx tsc --noEmit --project tsconfig.server-check.json
pnpm test
```

Workflow definitions remain in `.github/workflows/` and `.gitlab-ci.yml` for when CI resumes. See [`docs/devops/ci-cd.md`](devops/ci-cd.md).

## Contracts package

`@vettrack/contracts` is **consumed** from [`exposwifty31/literate-dollop`](https://github.com/exposwifty31/literate-dollop) via a `github:` path dependency in root `package.json`. This repo runs parity tests against the installed package; do not add `packages/contracts/` here.

```json
"@vettrack/contracts": "github:exposwifty31/literate-dollop#main&path:packages/contracts"
```

After bumping the dependency, run `bash scripts/ci/contracts-gate.sh`.

## Related docs

- [`docs/scope-change-2026.md`](scope-change-2026.md) — product scope after migrations 142–143
- [`docs/GITLAB_DEVELOPMENT.md`](GITLAB_DEVELOPMENT.md) — MR workflow when GitLab is active
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — tests, release flow, deployment variables
