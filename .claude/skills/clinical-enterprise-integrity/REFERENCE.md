# Reference — Clinical enterprise integrity

## Canonical repo anchors

| Concern | Where to look |
|--------|----------------|
| Domain language | `CONTEXT.md`, `docs/scope-change-2026.md` |
| Schema & tables | `server/schema/*.ts`, `migrations/` |
| REST routes | `server/routes/`, registration `server/app/routes.ts` |
| External PMS / adapters | `server/integrations/` |
| Audit logging | `server/lib/audit.ts` |
| Auth / clinic context | `server/middleware/auth.ts`, `server/lib/auth-mode.ts` |
| Background jobs | `server/jobs/runtime.ts`, `server/workers/`, `server/app/start-schedulers.ts` |
| Offline client | `src/lib/offline-db.ts`, `src/lib/sync-engine.ts` |
| Ward + Code Blue UI | `docs/architecture/offline-realtime-invariants.md`, `server/routes/code-blue.ts` |
| Equipment / rooms | `src/pages/equipment*.tsx`, `server/routes/equipment.ts` |

## Clinical–financial sync — review prompts

- Does completing this task **always** create the expected `vt_billing_*` / ledger rows when billing applies?
- Is inventory movement **one** job enqueue per completion (or explicitly idempotent)?
- Are failures visible (API error, job dead-letter, or UI toast)—not silent?

## Offline-first — review prompts

- Does a mutation work when offline (queued) and **replay** safely when online?
- Does the worker handle duplicate deliveries without double effect?

## RBAC — review prompts

- Is `clinicId` on **every** query?
- Is the operation allowed for this role per DB role, not claim text?

## ER Mode — review prompts

_Removed with migration 142 — ER Mode allowlist no longer applies._

## PowerShell — manual commands (repo root)

```powershell
# Core validation and production-readiness check
npx tsc --noEmit
pnpm validate:prod

# Default unit/integration suite (see vite.config.ts for excludes)
pnpm test

# Database + Drizzle alignment (requires DATABASE_URL and a reachable DB)
if ($env:DATABASE_URL) {
    pnpm exec drizzle-kit check
    pnpm db:migrate   # if migrations pending — manual per AGENTS.md / CLAUDE.md
    pnpm test -- tests/integrations/
}
```

Apply migrations before relying on DB-heavy tests. Vitest **excludes** some paths by default (e.g. certain DB and live-server tests); see `vite.config.ts` `test.exclude`.

## Risk label rubric (enhanced)

- **P0/P1**: Wrong clinic scope, missing audit on controlled action, duplicate billing, Code Blue offline mutation allowed, broken equipment checkout/return.
- **P1**: Schema or migration changes that break **backward compatibility** with `src/lib/offline-db.ts` / sync payloads for clients already in the field.
- **P2**: Degraded UX with recovery path in high-stress flows.
- **P3/P4**: Hygiene, logging noise, docs-only gaps.

When unsure, **bias to P1** for anything touching billing, identity, equipment state, or Code Blue.
