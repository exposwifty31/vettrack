# 08 — bulk-verify-room version pin (P3.3 / F5)

## Context

**F5:** Room verify overwrote equipment that changed between SELECT and UPDATE.

## Change

`post-equipment-bulk-verify-room.ts` — per-item update with `eq(equipment.version, capturedVersion)`; response `{ affected, skipped, roomName }`.

## Verification

`pnpm test -- equipment-bulk-verify-room-f5`

## Rollback

`git revert`
