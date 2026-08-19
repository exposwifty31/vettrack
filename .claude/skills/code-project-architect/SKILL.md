---
name: code-project-architect
description: Maintains scalable folder boundaries, domain-driven placement for server services versus React features, and naming consistency across VetTrack’s full-stack layout. Use when splitting large modules, adding large features, aligning with Clean Architecture boundaries, validating directory depth, or reconciling new code with CONTEXT.md terminology.
---

# Code project architect

## Quick start

1. Read **`CONTEXT.md`** for canonical domain language (ER wedge terms, relationships).
2. Place **HTTP adapters** in `server/routes/` (thin) delegating to **`server/services/`** (domain) with **`server/db.ts`** as schema truth.
3. Place **UI routes** in `src/pages/`; reusable behavior in `src/features/<domain>/` or `src/components/`.
4. After large moves, list over-nested directories: `find src server -type d -depth 8 -print`.

## Boundaries

| Layer | Location | Holds |
|-------|----------|--------|
| API surface | `server/routes/` | Validation, status mapping, auth wiring |
| Domain | `server/services/`, `server/lib/` | Transactions, business rules |
| Schema | `server/db.ts` + `migrations/` | Tables, Drizzle definitions |
| Client | `src/` | React, hooks, `src/lib/api.ts` clients |
| Shared constants/types | `shared/` | Cross-tier enums and guards |

## Anti-patterns

- **God files**: route files with hundreds of lines of SQL—extract services.
- **Cross-import shortcuts**: `src/` importing `server/` TS directly (use HTTP API).
- **Vendor logic** outside `server/integrations/` for external PIMS.

## Deep reference

Folder map, worktree boundaries, and enforcement rules: [REFERENCE.md](REFERENCE.md).

## Scripts

| Script | Purpose |
|--------|---------|
| `find src server -type d -depth 8 -print` | Lists excessively nested directories under `src/` / `server/` |
