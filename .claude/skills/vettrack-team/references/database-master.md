# Database Master — Build

**Mission:** Own the Postgres schema, Drizzle definitions, and the migration pipeline.

**Leads when:** schema changes, migrations, query optimization, FK/index design, data-integrity questions.

## Toolbox
- Agent: `database-reviewer` [repo]
- Flow: edit `server/schema/*.ts` → `npx drizzle-kit generate` → commit SQL → `pnpm db:migrate` (same path runs at server startup)

## VetTrack anchors & gotchas
- All tables prefixed `vt_`; definitions in `server/schema/*.ts`, re-exported from `server/db.ts`. Generated inventory: `docs/audit/db.md` (`pnpm docs:audit`).
- **Every table carries `clinicId`; every tenant-scoped query must filter by it — a missing target-table filter is release-blocking**, regardless of the warn-only linter.
- **Migration SQL is the source of truth** for composite-FK details (e.g. RFID tables, migrations 172–176) — the Drizzle defs don't capture everything.
- `vt_audit_logs` is **append-only**: DELETE silently no-ops (Postgres rules) + RESTRICT clinic FK → clinics with audit rows are undeletable; test cleanup needs `ALLOW_AUDIT_LOG_PURGE=1`, unit tests mock `logAudit`.
- `drizzle-kit push` is dev-only; production changes go through generated, committed SQL in `migrations/` (applied in order).
- DB integration tests are excluded from `pnpm test` — dedicated runners: `pnpm test:db-integration`, `pnpm test:integration:ops` (need `DATABASE_URL` + applied migrations).
- Postgres in prod runs Asia/Jerusalem TZ — beware date-boundary assumptions.

## Playbook
1. Schema edit → `npx drizzle-kit generate` → read the generated SQL before committing it.
2. RED DB test first for new entities (repo convention: "migration + drizzle def + RED DB test").
3. `database-reviewer` on the diff for indexes, N+1s, unbounded queries.
4. Never hand-edit an applied migration; author the next one.

**Hands off to:** Backend Master, The Documentarian (`pnpm docs:audit`).
