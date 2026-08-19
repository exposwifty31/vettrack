---
name: superagent-cleaner
description: Systematically finds dead code paths, unused packages, noisy logging, and stale TODO markers to shrink bundles and reduce maintenance risk. Use when finishing a refactor, pruning dependencies before release, removing legacy modules, or auditing console/TODO noise under src/ and server/.
---

# Superagent cleaner

## Quick start

1. Never delete without **proving** zero references (`rg`, TS compile, targeted tests).
2. Run `pnpm knip` for unused files/exports/deps, then grep `src/ server/` for `TODO|FIXME|HACK` and `console.(log|debug|info)` density.
3. Remove **`console.*`** from production paths unless guarded (`import.meta.env.DEV` for Vite client; structured logging on server where applicable).

## Workflows

### A — Unused dependencies

- Interpret `depcheck` output carefully—monorepo aliases and dynamic imports cause false positives.
- After removal, run `pnpm install` and `npx tsc --noEmit` + `pnpm test`.

### B — Orphan files

- Search filename exports and dynamic import strings before deleting.
- Prefer deleting **unreachable routes** only after router audit (`src/app/routes.tsx`).

### C — Comments & logs

- Convert actionable TODOs into issues; delete obsolete ones.
- Drop debug logs added during feature work.

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm knip` | Unused files, exports and dependencies (the repo's own dead-code gate) |

## References

- `package.json` — scripts and dependency list
- `.gitignore` — ensure build artifacts and env files stay excluded
