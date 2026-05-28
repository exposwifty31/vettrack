# 07 — Version pin on /revert (P3.2 / F4)

## Context

**F4:** Undo revert overwrote concurrent equipment changes inside the 15s window.

## Change

`post-equipment-revert.ts` — optimistic lock on `equipment.version`; empty `returning()` → 409 `EQUIPMENT_VERSION_CONFLICT`.

## Verification

`pnpm test -- equipment-revert-version-f4`

## Rollback

`git revert`
