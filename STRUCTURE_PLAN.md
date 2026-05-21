# VetTrack — Repository Structure Stabilization Plan

**Generated:** 2026-05-21  
**Rule:** Incremental, git-aware moves only — **no large rewrite in this pass.**

---

## Current layout (preserve)

```
/workspace
├── src/                 # React 18 + Vite frontend
│   ├── app/routes.tsx   # Lazy routes (wouter)
│   ├── pages/           # Route-level pages
│   ├── features/        # Feature modules
│   ├── components/      # Shared UI (shadcn)
│   ├── hooks/
│   └── lib/             # api.ts, offline-db, sync-engine, i18n
├── server/              # Express API
│   ├── index.ts
│   ├── db.ts            # Single schema source
│   ├── app/routes.ts    # ~49 routers
│   ├── routes/
│   ├── services/
│   ├── workers/
│   └── lib/
├── shared/              # Cross-cutting types/constants
├── tests/               # Vitest + Playwright (flat + subdirs)
├── scripts/             # Ops, i18n, seed
├── locales/             # en.json, he.json
├── migrations/
├── docs/
├── .github/workflows/
└── public/sw.js
```

**Do not introduce** monorepo tooling (Turborepo/Nx) without explicit approval.

---

## Target layout (incremental — not implemented yet)

Proposed **safe** end state (multiple small PRs):

```
/client          → symlink or gradual move from src/ (optional rename only)
/server          → already exists
/shared          → already exists
/tests
  /e2e
    /flows       → new (this PR)
    /simulation  → workday (staging-only)
  /vitest        → optional: group *.test.* by domain
/playwright      → configs at repo root today — may move configs only
/staging         → scripts/staging (merge from staging branch)
/phase-9         → optional group phase-9-* tests
/scripts
/docs
/.github
/infra           → railway.json, deploy.sh, future terraform
```

---

## Phased moves (one bounded PR each)

| PR | Move | Importers | Risk | Validation |
|----|------|-----------|------|------------|
| 1 | `tests/e2e/flows/` (additive) | None | Low | `PLAYWRIGHT_E2E=1` safe runner |
| 2 | Merge `scripts/staging/*` from `staging` → `main` | `package.json` scripts | Medium | Manual staging E2E |
| 3 | Move `playwright*.config.ts` → `playwright/` | CI workflow paths | Medium | Update workflow YAML |
| 4 | Group `tests/authority-*` → `tests/authority/` | Vitest glob unchanged if `tests/**` | Low | `pnpm test` |
| 5 | `docs/architecture.md` + runbooks | Links in README | Low | — |

**Per PR rules:**
- `git mv` only
- Update imports/paths in same PR
- No auth rewrites
- No API contract rewrites
- No package manager changes

---

## Mandatory docs (create/update in later PRs)

| Doc | Status | Notes |
|-----|--------|-------|
| `README.md` | Exists | Link to new audit artifacts |
| `docs/architecture.md` | **Create** | Consolidate README + CLAUDE.md overview |
| `docs/staging-e2e-runbook.md` | Exists (short on main) | Full body on `staging` branch |
| `docs/release-runbook.md` | Exists | — |
| `docs/playwright-matrix.md` | **Create** | Split CI / staging / UI smoke / Phase 9 |
| `CONTRIBUTING.md` | **Create** | Point to `run-safe-tests.sh`, branch flow |

---

## What not to move

| Area | Reason |
|------|--------|
| `server/db.ts` | Schema single source of truth |
| `src/lib/api.ts` | Frozen client pattern |
| `server/lib/event-publisher.ts` | Frozen realtime |
| `public/sw.js` | PWA build-tag contract |
| `locales/*.json` | i18n parity tooling paths |

---

## Rollback

Each structure PR: `git revert <merge-commit>` — no DB migrations involved for test-only moves.

---

## Deployment impact

**None** for documentation-only or test-directory additions.  
Config path changes (Playwright) require CI YAML update in same PR.
