---
name: vettrack-codebase-relevance-audit
description: Thoroughly map the VetTrack application and classify every repository file as app-relevant, support-relevant, generated/ephemeral, uncertain, or deletion-candidate. Use when the user asks to scan the whole VetTrack codebase, understand backend/API/frontend UI/UX, find dead or irrelevant files, clean up repository contents, or decide what can be safely deleted.
---

# VetTrack Codebase Relevance Audit

## Core Rule

Never recommend deleting a file from intuition alone. Classify each file from observable evidence: imports, route registration, build config, package scripts, test references, generated-output conventions, git history, docs links, runtime paths, and VetTrack frozen-surface constraints.

## Required Context

Before auditing, read:

- `CLAUDE.md`
- `PLAN.md`
- `TASKS.md`
- `docs/CONVENTIONS.md`
- `DEFINITION_OF_DONE.md`
- `docs/cloud-agent-starter-skill.md` when environment setup or test routing is needed
- The frozen architecture surfaces in `CLAUDE.md` before touching realtime, Code Blue, PWA, authority, appointments/task naming, audit, telemetry, auth, or multi-tenancy files

If any required file is missing or incomplete, report it before proceeding.

## Workflow

1. Establish repo scope.
   - Run `git status --short`, `git ls-files`, and `rg --files --hidden -g '!node_modules' -g '!dist'`.
   - Run `python3 .claude/skills/vettrack-codebase-relevance-audit/scripts/inventory_files.py --root . --output /tmp/vettrack-file-inventory.json`.
   - Treat ignored build outputs and dependency folders as inventory context, not app files, unless they are intentionally committed.

2. Build the app map before judging files.
   - Backend: inspect `server/index.ts`, `server/app/routes.ts`, `server/routes/`, `server/services/`, `server/schema/`, middleware, workers, jobs, integrations, and startup/scheduler wiring.
   - API: map registered Express routes to service functions, schemas, middleware, auth/clinicId handling, frontend API clients in `src/lib/api.ts`, and tests.
   - Frontend: inspect `src/app/routes.tsx`, route pages, shared components, feature modules, hooks, i18n access, offline/PWA wiring, and UI flows.
   - Ops/build: inspect package scripts, tsconfigs, Vite/Vitest/Playwright configs, migrations, public assets, scripts, docs, and generated files.

3. Classify literally every file.
   Use one of:
   - `keep-app`: directly used by runtime app, API, DB schema/migrations, UI, service worker, auth, realtime, workers, integrations, or i18n.
   - `keep-support`: tests, docs, scripts, configs, audit artifacts, agent instructions, CI/tooling, or plans that support development/operations.
   - `generated-or-ephemeral`: generated, cache, build output, local report, or reproducible artifact. State whether it is committed and whether deletion should be via `.gitignore`, regeneration, or explicit cleanup.
   - `uncertain`: not enough evidence. State the exact checks needed before deletion.
   - `delete-candidate`: no inbound references, no script/config/runtime/historical reason found, not a frozen surface, and verification commands are identified.

4. Verify deletion candidates.
   - Search exact filename, exported symbols, route paths, i18n keys, schema/table names, script names, and docs links.
   - Check package scripts and config globs before marking scripts/config/tests/docs as removable.
   - For frontend assets, check CSS references, Vite public paths, JSX imports, manifest/service-worker references, and browser-visible routes.
   - For migrations, never mark committed historical migrations deletable unless the user explicitly asks for migration-squash strategy.
   - For frozen surfaces, default to `keep-app` or `uncertain` unless there is strong evidence the file is obsolete and no runtime contract depends on it.

5. Produce an audit report before editing.
   Include:
   - Backend/API map
   - Frontend UI/UX map
   - File classification table or CSV/JSON artifact covering every file
   - High-confidence delete candidates with evidence
   - Uncertain files and next checks
   - Verification commands
   - Risk notes for multi-tenancy, realtime/PWA/Code Blue, auth, i18n, migrations, and audit telemetry

6. Delete only with explicit approval.
   - Do not remove files during the discovery pass.
   - After approval, delete in small batches, run targeted checks after each batch, then run `npx tsc --noEmit` and `pnpm test`.
   - Add follow-up items noticed but not acted on to `TASKS.md` Backlog.

## Evidence Heuristics

- Prefer `rg` over grep.
- Use AST-aware or tool-supported analysis where available, but do not trust static import graphs alone; routes, scripts, public assets, migrations, service workers, and dynamic imports often matter outside TypeScript imports.
- Generated files can still be required when the build or tests expect them checked in.
- Documentation can be support-relevant even when not imported.
- A file with zero references can still be required by naming convention, external tooling, package scripts, deployment, or historical migration order.

## Output Shape

For a full audit, report:

```markdown
## App Map
[backend/API/frontend summary]

## Every-File Classification
[path | classification | evidence | risk | proposed action]

## Delete Candidates
[path | why likely removable | required verification]

## Uncertain
[path | missing evidence | next check]

## Verification
Run: [exact commands]

## Follow-up items (not acted on)
- [item added to TASKS.md Backlog]
```

For very large inventories, write the complete table to an artifact and summarize the highest-signal findings in chat.
