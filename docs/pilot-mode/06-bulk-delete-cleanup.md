# 06 — bulk-delete dependent cleanup (P3.1 / F3)

## Context

**F3:** `POST /api/equipment/bulk-delete` soft-deleted equipment but left active waitlist and staging-queue rows orphaned.

## Change

`server/routes/equipment/handlers/post-equipment-bulk-delete.ts` — after soft-delete, bulk-cancel `vt_equipment_waitlist` (`waiting`/`notified`) and `vt_staging_queue` (`active`) for deleted ids.

## Verification

`DATABASE_URL=... pnpm test -- equipment-bulk-delete-f3`

## Rollback

`git revert`
