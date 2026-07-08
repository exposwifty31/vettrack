# Data Codemap
<!-- Generated: 2026-07-08 | 64 tables, 9 schema files, 162 migrations | Token estimate: ~600 -->

PostgreSQL + Drizzle ORM. All tables prefixed `vt_`. Source of truth: `server/schema/*.ts` (re-exported from `server/db.ts`). **Every table has `clinicId`; every query MUST filter it.** Full table list: [`docs/audit/db.md`](../audit/db.md).

## Schema files → domains (64 tables total)
| File | Domain | Key tables |
|------|--------|-----------|
| `core.ts` | tenancy/identity | `vt_clinics`, `vt_users`, `vt_apple_oauth_tokens` |
| `equipment.ts` | THE core domain (18) | `vt_equipment`, `vt_rooms`, `vt_docks`, `vt_equipment_waitlist`, `vt_staging_queue`, `vt_equipment_returns`, `vt_scan_logs`, `vt_asset_types`, `vt_equipment_readiness_config` |
| `er.ts` | emergency (6) | `vt_code_blue_sessions`, `vt_code_blue_log_entries`, `vt_code_blue_presence`, `vt_crash_cart_*` |
| `inventory.ts` | inventory (10) | `vt_containers`, `vt_items`, `vt_dispense_events`, `vt_restock_*`, `vt_purchase_orders`, `vt_po_lines` |
| `tasks.ts` | unified tasks | `vt_appointments` (frozen name; UI = "Tasks") |
| `ops.ts` | operations (18) | `vt_shifts`, `vt_shift_sessions`, `vt_event_outbox`, `vt_clinical_check_ins`, `vt_audit_logs`, `vt_server_config`, `vt_push_subscriptions` |
| `integrations.ts` | external PMS (7) | `vt_integration_configs`, `vt_integration_sync_*`, `vt_integration_webhook_events` |
| `helpers.ts` / `index.ts` | shared column helpers + barrel | — |

## Migrations
`migrations/*.sql` — **162 files** (latest `159_shift_messages_drop_session_fk.sql`), run in order at server startup and via `pnpm db:migrate`. Author with `npx drizzle-kit generate` after editing `server/schema/*`, then commit the SQL.

## Load-bearing tables
- `vt_event_outbox` — realtime source of truth; `id` is the monotonic SSE cursor. Janitor + DLQ scanner maintain it.
- `vt_clinical_check_ins` — open row → check-in authority; absent → **Strategy A** shift-derived path (frozen).
- `vt_audit_logs` — **append-only**; DELETE silently no-ops (DB rules) + RESTRICT clinic FK. Purge needs `ALLOW_AUDIT_LOG_PURGE=1`.

## Removed scope (migrations 142–143)
ER/patient/hospitalization tables, medication tasks, drug formulary, pharmacy forecast — see `docs/scope-change-2026.md`. `src/types/billing.ts` is a residual dead type (TECH_DEBT TD-7).

## Security posture
Tenancy is **application-layer** (`clinicId` filter + `tenant:lint` CI gate) — **no Postgres RLS** today. RLS is a deferred, owner-gated hardening item (TECH_DEBT TD-12), never a UX-phase change. Integration credentials AES-256-GCM in `vt_server_config` when `DB_CONFIG_ENCRYPTION_KEY` set.
