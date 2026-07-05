# Classification Rubric

Use this rubric after building the backend/API/frontend app map.

## Keep-App

Use for runtime, deploy, or persistent product behavior:

- Express entry, route registration, routes, services, middleware, DB schema, migrations, workers, jobs, integrations, auth, audit, metrics, authority, and realtime infrastructure.
- React routes, pages, components, hooks, API client functions, types, i18n runtime, service worker, manifest, public assets referenced by runtime paths, and offline/PWA code.
- Any file named by package scripts, tsconfig/Vite/Vitest/Playwright/Drizzle config, deployment config, or startup code.

## Keep-Support

Use for files that support humans or automation:

- Tests, fixtures, mocks, scripts, docs, architecture notes, audit logs, plans, task lists, agent instructions, Cursor rules, and verification artifacts that remain useful.
- Generated TypeScript or docs when checked-in consumers expect them.

## Generated-Or-Ephemeral

Use for files that should be regenerated or ignored:

- Build outputs, caches, local reports, coverage, temporary exports, generated inventories, and machine outputs not required in git.
- State whether the file is tracked. A tracked generated file may still be intentionally committed.

## Uncertain

Use when evidence is incomplete:

- Dynamic import, shell script, deployment, public URL, migration order, or external integration could still reference it.
- State the missing check instead of guessing.

## Delete-Candidate

Use only when all are true:

- No import, route, config, script, docs, public path, migration, test, deployment, or external-tool reference is found.
- Not part of a frozen VetTrack surface.
- Not historical migration data.
- Verification commands are listed.
- Deletion will be reviewed and approved separately.
