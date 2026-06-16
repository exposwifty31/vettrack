# VetTrack — Project instructions for AI assistants (ChatGPT / custom instructions)

Use this as **Custom Instructions**, **Project knowledge**, or paste the summary block at the start of a coding session when working on **VetTrack** ([vettrack.uk](https://vettrack.uk)): a **veterinary hospital operations PWA** with offline-first equipment workflows, clinic multi-tenancy, the unified clinical task model (rendered as **Tasks**), Code Blue runtime, and external PMS integrations.

---

## One-line identity

**Stack:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Wouter + TanStack Query + Dexie (offline) · Express + TypeScript (`tsx`) + Drizzle ORM + PostgreSQL · Clerk auth · BullMQ + Redis for workers · Web Push, Sentry.

---

## Non-negotiable rules

1. **Multi-tenancy:** Nearly all data is scoped by **`clinicId`**. Every new query must filter by the authenticated clinic; never leak rows across clinics.
2. **Naming:** **English only** for identifiers, files, types, and APIs. **Hebrew (and other locale strings)** belong in UI/copy via the app's i18n catalogs in `locales/*.json`—not hardcoded in source. User-facing copy uses **Tasks / משימות**; the `vt_appointments` table, `/api/appointments` route, and `appointmentsPage.*` i18n key namespace are intentionally **not** renamed (Phase 6 §17).
3. **Scope:** Implement **only what was asked**. No drive-by refactors, no unrelated files, no extra docs unless requested.
4. **Schema-first:** Tables live in **`server/schema/*.ts`** (re-exported from `server/db.ts`). After schema edits, run `npx drizzle-kit generate` and commit SQL.
5. **API surface:** Prefer **`src/lib/api.ts`** for client-server contracts; keep **`src/types/`** aligned with API shapes when adding endpoints.
6. **Workers:** Background jobs live under **`server/workers/`** and schedulers/bootstrapping are wired from **`server/app/start-schedulers.ts`** (verify imports when adding queues).
7. **Offline:** IndexedDB changes require **Dexie version bumps + migrations** in the Dexie setup—do not silently extend tables without a migration path. **Code Blue mutations are never queued offline** — they fail loud and increment a bounded counter (`src/lib/offline-emergency-block.ts`).
8. **Realtime transport is SSE** (`/api/realtime/stream`, outbox-backed). Reconnect uses replay + snapshot reconciliation. Do not introduce WebSockets, parallel polling paths, or cache emergency endpoints in the service worker.
9. **Enforcement evaluators** follow `off | shadow | enforce` per-clinic. Strategy A safety net (legacy shift-derived authority) is **active** for un-migrated clinics — do not remove it.

---

## Repo map (where to look first)

| Area | Location |
|------|-----------|
| Drizzle schema | `server/schema/*.ts` + `server/db.ts` |
| Express bootstrap & middleware | `server/index.ts` |
| API route registration | `server/app/routes.ts` (all `/api/*` routers mounted here) |
| Background worker / scheduler registration | `server/app/start-schedulers.ts` |
| Realtime transport | `server/routes/realtime.ts`, `server/lib/event-publisher.ts`, `src/lib/realtime.ts` |
| Code Blue runtime | `server/routes/code-blue.ts`, `server/lib/code-blue-keepalive.ts`, `src/lib/offline-emergency-block.ts` |
| Authority / enforcement | `server/lib/authority.ts`, `server/lib/authority/enforcement/*` |
| Audit kinds (closed union) | `server/lib/audit.ts` → `AuditActionType` |
| Client API helpers | `src/lib/api.ts` |
| Routing (SPA) | `src/app/routes.tsx` (wouter, lazy-loaded) |
| i18n | `lib/i18n/` (server middleware), `src/lib/i18n.ts` (+ generated types) |
| Offline/sync | Dexie + `src/lib/sync-engine.ts` (does NOT cover Code Blue mutations) |
| Migrations SQL | `migrations/` |
| Canonical architecture entry points | `README.md`, `CLAUDE.md`, `CONTEXT.md` |
| Cursor / cloud agent runbook | `AGENTS.md`, `docs/cloud-agent-starter-skill.md` |

---

## Environment & running locally

- **Node:** `>=22.12.0` (see `package.json` / `.nvmrc`).
- **Package manager:** **pnpm 9.15.9** (`packageManager` field).
- **Backend** listens on **`PORT`** (set **`3001` in dev** so Vite’s proxy in `vite.config.ts` matches). If `PORT` is missing, the server may default to **3000** and break the dev proxy.
- **Frontend (Vite):** dev server on **port 5000** (`pnpm dev` runs both via `concurrently`).
- **Database:** PostgreSQL; connection via **`DATABASE_URL`** (and related `PG*` vars if used).
- **Dotenv:** Server loads **`dotenv/config`** in `server/index.ts`, so a root **`.env`** is supported for backend vars. Vite still only auto-exposes `VITE_*` to the client.
- **Migrations:** **`runMigrations()`** is invoked during server startup in `server/index.ts` and applies any pending SQL files in `migrations/`. You can also use **`pnpm db:migrate`** / **`pnpm migrate`** to run the same path on demand. After schema edits in `server/db.ts`, run **`npx drizzle-kit generate`** and commit the new SQL file.

**Dev (Unix-style env):**

```bash
DATABASE_URL=postgres://… PORT=3001 pnpm dev
```

**Dev (PowerShell on Windows):**

```powershell
$env:DATABASE_URL="postgres://..."; $env:PORT="3001"; pnpm dev
```

---

## Auth notes

- **Clerk** is used in production (`VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`).
- **Local dev:** Without Clerk secrets, the backend may use **development bypass behavior** (see `AGENTS.md` for nuances). The client still wraps Clerk; missing publishable key can cause browser-side Clerk errors—consult `AGENTS.md` for HTTPS/local testing if using production Clerk keys.

---

## Commands reference

| Goal | Command |
|------|---------|
| Install | `pnpm install` |
| Dev (API + Vite) | `pnpm dev` (ensure `PORT=3001` and `DATABASE_URL` for DB features) |
| Typecheck | `npx tsc --noEmit` |
| Tests | `pnpm test` |
| Production build | `pnpm build` |
| Start (production entry) | `pnpm start` |

---

## Testing & quality expectations

- **`pnpm test`** runs many Node/tsx test files—add or extend tests in the same style when fixing bugs or adding critical behavior.
- **No ESLint** is configured in-repo; rely on TypeScript strictness and tests.
- After substantive TS changes, **`npx tsc --noEmit`** should pass.

---

## Domain highlights (avoid hallucinating scope)

- **Equipment registry** with QR/NFC, scans, folders, alerts, checkout/return flows.
- **Rooms / Asset Radar** — room sync state, verification, NFC deep links.
- **Tasks** (unified model on `vt_appointments`) — medication tasks tie into **inventory jobs** and async deduction; see the medication-execution flow in `CLAUDE.md`. Two parallel medication models exist by design — see `docs/architecture/adr-001-medication-task-models.md`.
- **Code Blue runtime** — SSE-driven, server-confirmed, online-only emergency mutations; see `CLAUDE.md` → "Code Blue runtime guarantees".
- **Department Display** — `/display` route with `useDisplayHeartbeat`; reconciliation via SSE keepalives, not polling.
- **Realtime** — SSE + outbox-backed ordering + BroadcastChannel cross-tab gossip; see `CLAUDE.md` → "Realtime (Phase 9)".
- **Tables** are prefixed **`vt_`** (see `README.md` for the table list).

---

## Out of date elsewhere — trust the code

When in doubt, source of truth is the code (`server/app/routes.ts`, `server/schema/`, `src/lib/realtime.ts`, `public/sw.js`) and canonical docs (`README.md`, `CLAUDE.md`, `CONTEXT.md`, [`docs/scope-change-2026.md`](docs/scope-change-2026.md)).

---

## Optional: short block to paste into ChatGPT “Custom instructions”

```
You are helping with VetTrack (vettrack.uk): a veterinary hospital operations PWA. React+Vite+TS+Tailwind+shadcn frontend, Express+Drizzle+PostgreSQL backend, Clerk, BullMQ+Redis, SSE realtime. Every query must respect clinicId multi-tenancy. English identifiers only; user-facing copy via i18n (locales/*.json); user copy says "Tasks" but the appointments table/route/i18n namespace stay. Schema in server/db.ts; routes registered in server/app/routes.ts; client API patterns in src/lib/api.ts. Realtime is SSE — no WebSockets, no polling-based recovery for emergency state. Code Blue mutations are online-only, never queued offline. Enforcement evaluators follow off|shadow|enforce per clinic; Strategy A safety net stays. Dev: pnpm dev (PORT=3001, DATABASE_URL set; Vite on 5000). After TS edits run npx tsc --noEmit. Implement only requested changes.
```

---

*Generated for repository **VetTrack**. Update this file when stack or bootstrap behavior changes materially.*
