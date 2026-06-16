# VetTrack Migration System

## Canonical Command

```
pnpm migrate          # applies pending SQL migrations to DATABASE_URL
pnpm db:migrate       # alias — runs the same command
```

Both run `scripts/run-migrations.ts` → `server/migrate.ts`: a custom raw-SQL runner that tracks applied migrations in the `vt_migrations` table, protected by a PostgreSQL advisory lock to prevent concurrent runs.

## Generating New Migrations

Edit Drizzle schema in `server/schema/*.ts` (re-exported from `server/db.ts`), then:

```
npx drizzle-kit generate
```

This creates a new `.sql` file in `migrations/` and updates `migrations/meta/_journal.json`. Commit both files.

**Naming convention:** `NNN_description.sql` where NNN is the next sequential number. Latest applied files include `154_vt_equipment_name_he.sql` — check `migrations/` for the current tail before generating.

## The Duplicate 019 Situation

`migrations/` contains two files numbered 019:
- `019_add_user_display_name.sql`
- `019_smart_role_notifications_schema.sql`

Both have been applied to production (tracked by distinct filenames in `vt_migrations`). Do **not** rename them — renaming would cause re-application.

## What `pnpm db:migrate` Used to Do

Previously `db:migrate` ran `drizzle-kit migrate`. That path is retired — use `pnpm migrate` or `pnpm db:migrate` only.

## CI

GitLab CI and GitHub Actions run `pnpm migrate` against test PostgreSQL before integration tests.

## Migration Runner Internals

`server/migrate.ts`:
1. Acquires advisory lock `123456` to prevent concurrent migration runs
2. Creates `vt_migrations` table if it doesn't exist
3. Reads `migrations/*.sql` files sorted alphabetically, skipping already-applied filenames
4. Runs each in a transaction; rolls back on error
5. Releases advisory lock

## Scope migrations (June 2026)

- **142** — ER, patients, hospitalizations removed
- **143** — medication tasks, formulary, pharmacy forecast removed

See [`scope-change-2026.md`](./scope-change-2026.md).
