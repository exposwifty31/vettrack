# Repository layout (VetTrack)

## Worktree architecture

VetTrack uses a single-repo **worktree**: frontend (`src/`), backend (`server/`), shared types (`shared/`), and migrations stay isolated by folder boundaries rather than separate git worktrees.

### Directory standards

| Area | Rule |
|------|------|
| `server/integrations/` | **Strict adapter pattern** — vendor I/O, canonical mapping, webhooks. No core clinical domain rules here; delegate to `server/services/`. |
| `src/lib/` | Core shared client utilities (offline DB, sync engine, API helpers). Keep free of route-specific UX. |
| `src/pages/` | Route entry screens — **keep lean**; move data and effects to hooks under `src/features/` or `src/hooks/`. |

### Enforcement rules

1. **Max depth**: Prefer not to exceed **8** directory levels under `src/` or `server/` for feature code. Validate with `find src server -type d -depth 8 -print`.
2. **Naming**: Prefer **kebab-case** for new React pages and feature files (e.g. `ward-view.tsx`). Existing files may differ; match nearby names when editing.
3. **Domain isolation**: **Clinical and billing domain logic** must not depend on UI-specific React components—keep rules in `server/services/` or typed helpers consumed via hooks.

---

High-level map aligned with `CLAUDE.md` / `AGENTS.md`. Paths are repo-relative.

## Top level

| Path | Role |
|------|------|
| `src/` | React 18 + Vite frontend |
| `server/` | Express API, Drizzle, workers, integrations |
| `shared/` | Types and constants shared across tiers |
| `migrations/` | Ordered SQL migrations (`pnpm db:migrate`) |
| `scripts/` | Ops, validation, seeds |
| `tests/` | Vitest suites |
| `locales/` | `en.json`, `he.json` — user-visible copy |
| `docs/` | Specs and plans (superpowers, ADRs) |

## Frontend (`src/`)

| Path | Role |
|------|------|
| `src/app/routes.tsx` | Wouter routes (lazy pages) |
| `src/pages/` | Route-level screens |
| `src/features/` | Feature modules (auth, containers, …) |
| `src/components/` | Shared UI; `components/ui/` shadcn primitives |
| `src/hooks/` | Cross-cutting hooks |
| `src/lib/` | API client, i18n, offline DB, sync engine |
| `src/integrations/` | Reserved for client-side integration adapters when added (`AGENTS.md`) |

## Backend (`server/`)

| Path | Role |
|------|------|
| `server/index.ts` | Express bootstrap |
| `server/app/routes.ts` | Registers route modules |
| `server/routes/` | Per-resource HTTP handlers |
| `server/services/` | Domain services |
| `server/middleware/` | Auth, locale, validation |
| `server/workers/` | BullMQ / background workers |
| `server/integrations/` | PIMS adapters, webhooks, canonical contracts |
| `server/db.ts` | Drizzle schema (single source of truth) |

## Depth guideline

Prefer **shallow** feature folders: `src/features/<domain>/components`, `hooks`, `types`. If depth exceeds ~6 segments from `src/` or `server/`, consider extracting a package-internal barrel or splitting domain.

Use `find src server -type d -depth 8 -print` to list outliers.
