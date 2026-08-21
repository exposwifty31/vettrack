# VetTrack Migration System

## Canonical Command

```
pnpm migrate          # applies pending SQL migrations to DATABASE_URL
pnpm db:migrate       # alias — runs the same command
```

Both run `scripts/run-migrations.ts` → `server/migrate.ts`: a custom raw-SQL runner that tracks applied migrations in the `vt_migrations` table, protected by a PostgreSQL advisory lock to prevent concurrent runs.

## Authoring a New Migration

Migrations in this repo are **hand-authored SQL**. They are not `drizzle-kit` output — see the next section for why.

1. Edit the Drizzle schema in `server/schema/*.ts` (re-exported from `server/db.ts`). Those definitions exist for **query typing**; they are not the source of truth for the database.
2. Find the current tail: `ls migrations/*.sql | sort -V | tail -1` (`185_rls_role_precondition_guard.sql` as of 2026-08-19).
3. Hand-write `migrations/NNN_description.sql` using the next number.
4. Make every statement idempotent — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`, exception-guarded `CREATE TYPE`. Fresh environments (including CI) replay the entire directory in order, so a migration that cannot be re-run against a partially-built schema breaks the fresh-DB path.
5. **No `CREATE INDEX CONCURRENTLY`**, and nothing else Postgres bars from a transaction block (`VACUUM` is the other one that comes up). The runner wraps each file in a single `BEGIN`/`COMMIT` (`server/migrate.ts:82-85`), so a concurrent build does not degrade — it aborts the whole migration with SQLSTATE `25001`, `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`. Use a plain `CREATE INDEX IF NOT EXISTS` and accept the write lock — **brief only at the
current per-clinic table sizes**, not in general: the lock is held for the whole index build, so
on a table large enough for that to matter the index belongs in an out-of-band concurrent-build
script, not in a migration file; `migrations/168_sweep_anchor_index.sql` reasons that trade-off out in full, and `136`, `164` and `169` each re-derived the same constraint independently because it was written down nowhere central. A genuinely concurrent build has to be an out-of-band script, not a migration file.
6. Commit the `.sql` file. The runtime applies it at startup; `pnpm db:migrate` runs the same path on demand.

### Why not `npx drizzle-kit generate`?

> **Scope, 2026-08-20:** everything in this section is **pre-retirement history**. Commit `b043585de`
> removed the config and the tool, so there is no `drizzle-kit` to run and `pnpm migrate` /
> `pnpm db:migrate` is the only migration path. It is kept because restoring Drizzle tooling would
> recreate the module-resolution hazard described below, and because reason 2 is about the schema
> definitions themselves and still holds.

Two independent reasons, both re-verified 2026-08-19 (while the tool was still installed):

1. **It does not run.** ~~`drizzle.config.ts`~~ pointed `schema` at `server/schema/index.ts`, an ESM barrel whose re-exports carry `.js` specifiers (`export * from "./core.js"`). The app's own toolchain (`moduleResolution: "bundler"`, tsx/Vite) maps those onto the sibling `.ts` files; drizzle-kit 0.28.1 loads the file through a CJS require hook that resolves them literally and exits with `Cannot find module './core.js'` before reading a single table. `drizzle-kit push` (`pnpm db:push`) fails at exactly the same point.
2. **The Drizzle definitions are deliberately not a faithful mirror of the database.** Several tables carry in-code notes saying the migration is the source of truth and the TS definition is "for query typing only" — PG15+ column-list `ON DELETE SET NULL`, composite FKs, partial indexes and JSONB defaults that drizzle-kit cannot express (`server/schema/equipment.ts:226`, `:313`, `:366`; the first states outright that "drizzle-kit generate is non-functional in this repo"). Even a working generator would emit a diff that contradicts the real schema.

The last migrations drizzle-kit actually produced are `0018_striped_valkyrie.sql` and `0019_puzzling_tempest.sql` (April 2026) — the only two files in the directory that still carry its `--> statement-breakpoint` markers — plus `0020_abnormal_iron_monger.sql`, which its journal recorded as idx 20 without emitting breakpoint markers. Everything from `0021` onward is hand-written.

`migrations/meta/` — drizzle-kit's `_journal.json` plus three snapshots — was **deleted on 2026-08-19**. It had stopped at `0020` in April 2026 while the directory grew to 188 `*.sql` files (187 of them applied; `185_rls_role_precondition_guard.sql` is the highest-numbered), `server/migrate.ts` never read it, and stale bookkeeping that nobody maintains is worse than none. If drizzle-kit is ever re-adopted, regenerate a baseline against the real database rather than restoring those files.

**The deletion enlarged one latent hazard, so record it plainly.**

> **Correction 2026-08-20 — the hazard is now moot; the analysis is kept for the record.**
> ~~`drizzle.config.ts` still has `out: "./migrations"`~~ — the config file was
> **deleted** in commit `b043585de` ("chore: retire drizzle-kit, two stale always-on rules, and the
> staging CI wrappers"), and `drizzle-kit` is no longer a dependency.
> <!-- vt-claim: absent drizzle-kit scope=deps -->
> With no config there is nothing for drizzle-kit to load, so the full-baseline emit described below
> cannot be reached, and the closing advice — repoint `out` — has nothing left to repoint. Caught by
> resolving every path this document names against the tree.

The hazard as recorded before that deletion:
 Before the deletion, a hypothetically-working `generate` would have diffed against snapshot `0020` and emitted a partial migration into the hand-authored directory. With the journal gone, drizzle-kit treats the project as fresh — it recreates an empty `out/meta` and would emit a **full baseline of every table**, which `server/migrate.ts` would then pick up at startup and apply as an unguarded CREATE-everything file. `generate` cannot run at all today (reason 1 above), so this is latent, not live; the fix is to point `out` somewhere other than `./migrations` before anyone repairs the schema entry point.

## Numbering, duplicates, and the `b` suffix

`server/migrate.ts` sorts by **leading numeric value**, with a `localeCompare` tie-break — not alphabetically. So `019b` always runs after `019`, and the legacy four-digit `0021_*` sorts as 21.

### Resolved: the duplicate 019 (fixed 2026-05-02)

Historical, no action needed. Two files once shared the prefix `019`. PR #203 (`e630dd373`) renamed the second to `019b_smart_role_notifications_schema.sql`, changed `server/migrate.ts` to sort by leading numeric value, and added `018b_fix_migration_filenames.sql`, which `UPDATE`s `vt_migrations.filename` for any database that had already applied the old names (a no-op everywhere else). `019b` is itself fully idempotent. `076` → `076b` got the same treatment in the same commit.

### Open, and left alone on purpose: duplicate number 141

Two unrelated migrations both claim number 141:

- `141_drop_billing_usage_sessions.sql` (merged 2026-06-02, `e5d5ac8ed`)
- `141_drop_vt_equipment_intelligence.sql` (merged 2026-06-02, `04b6a373e`)

They landed the same day from different branches and were never reconciled. This is harmless in practice: the object sets are disjoint (billing/usage tables and columns vs. the two `vt_equipment_intelligence_*` tables), every statement is `IF EXISTS`-guarded, the runner tracks applied migrations by filename so each applies exactly once, and the numeric tie is broken deterministically by `localeCompare` (`billing` before `equipment_intelligence`).

They are **not** renamed and should not be. Committed historical migrations are never renamed or deleted on their own; the `018b`/`019b`/`076b` rename was only safe because it shipped with the tracking-table `UPDATE` in the same commit, and there is no defect here to justify repeating that. Just do not pick 141 for anything new.

## What `pnpm db:migrate` Used to Do

Previously `db:migrate` ran `drizzle-kit migrate`. That path is retired — use `pnpm migrate` or `pnpm db:migrate` only.

## CI

GitHub Actions runs `pnpm migrate` against test PostgreSQL before integration tests (`ci.yml`, `playwright.yml`, `release-gate.yml`, `flake-detection.yml`, `e2e-simulation-nightly.yml`).

## Migration Runner Internals

`server/migrate.ts`:
1. Acquires advisory lock `123456` on a direct (non-PgBouncer) connection to prevent concurrent migration runs
2. Creates the `vt_migrations` table if it doesn't exist
3. Reads `migrations/*.sql` (skipping `*.down.sql`), sorted by leading numeric value with a `localeCompare` tie-break, and skips filenames already recorded in `vt_migrations`
4. Runs each remaining file in **one** transaction (`BEGIN` → the file's SQL → `INSERT INTO vt_migrations` → `COMMIT`), recording the filename on commit; rolls back and throws on error. Because the whole file sits inside that one transaction, a migration cannot contain any statement Postgres refuses in a transaction block — see the `CREATE INDEX CONCURRENTLY` rule in the authoring steps above
5. Releases the advisory lock

It reads nothing but `migrations/*.sql` — no journal, no snapshots, no subdirectories.

## Scope migrations (June 2026)

- **142** — ER, patients, hospitalizations removed
- **143** — medication tasks, formulary, pharmacy forecast removed

See [`scope-change-2026.md`](./scope-change-2026.md).
