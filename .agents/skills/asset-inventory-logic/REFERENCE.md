# Asset & inventory — reference map

## Documentation

- **Architecture & equipment**: `CONTEXT.md`, `docs/scope-change-2026.md`, equipment routes under `server/routes/equipment.ts`.
- **Offline stores**: `src/lib/offline-db.ts` — equipment cache, pending queue entries.
- **Sync**: `src/lib/sync-engine.ts` — retries, ordering, failure surfacing.

## Database (authoritative)

Defined in `server/schema/` (prefix `vt_`):

| Area | Typical tables |
|------|----------------|
| Scans | `vt_scan_logs` — `clinicId`, `equipmentId`, `userId`, `status`, `timestamp` |
| Moves | `vt_transfer_logs` — folder/room transfers |
| Equipment | `vt_equipment`, rooms linkage as implemented |
| Alerts / undo | `vt_whatsapp_alerts`, `vt_undo_tokens` (ties to `scan_log_id`) |

Every query in production paths must filter **`clinicId`** (see enterprise security skill).

## Workers & jobs

- Inventory deduction runs asynchronously after medication completion; equipment NFC flows may enqueue related jobs—check `server/workers/` and schedulers in `server/app/start-schedulers.ts`.

## Verification script prerequisites

`scripts/verify-nfc-scan-audit.ps1` expects `psql` on PATH and `DATABASE_URL` set (same as `pnpm db:migrate`).
